import {
  Component, OnInit, OnDestroy, ElementRef, ViewChild,
  ChangeDetectorRef, HostListener,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { VideoService } from '../../services/video.service';
import { CommentSectionComponent } from '../comment-section/comment-section.component';
import Hls from 'hls.js';
import { Subscription } from 'rxjs';
import { TelemetryService } from '../../services/telemetry.service';
import { PredictionService } from '../../services/prediction.service';

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    CommentSectionComponent,
  ],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css'],
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement',   { static: false }) videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('playerContainer',{ static: false }) playerContainerRef!: ElementRef<HTMLDivElement>;

  video: any = null;
  loading = true;
  error: string | null = null;
  isOwner = false;
  isDeleteHovered = false;
  descOpen = false;
  aiSummaryOpen = false;
  currentUserId: string | null = null;
  userReaction: 'liked' | 'disliked' | 'none' = 'none';
  isLiking = false;
  isDisliking = false;

  private hls: Hls | null = null;
  hlsLevels: Array<{ name: string; index: number }> = [];
  hlsCurrentLevel = -1;
  hlsAutoLevel = -1;
  showSettingsMenu = false;

  /** Set to true just before we force a level change via GenABR so the
   *  LEVEL_SWITCHED handler can tag the switch as 'genabr_override'. */
  private _genabrForcedLevel = false;
  /** Track how many consecutive 'normal' cycles before releasing the
   *  manual level lock and handing control back to ABR auto. */
  private _normalCycleCount = 0;
  private readonly NORMAL_RELEASE_CYCLES = 2;

  isPlaying = false;
  isMuted = false;
  currentTime = 0;
  duration = 0;
  controlsVisible = true;
  isFullscreen = false;
  private controlsTimer: any = null;
  // Blocks the synthesised click/mousemove that follows a touch tap.
  private _touchHandled = false;
  private predictionSub: Subscription | null = null;

  // ── GenABR activity badge ──────────────────────────────────────────────────
  genabrBadgeVisible   = false;   // drives *ngIf + CSS enter/leave animation
  genabrBadgeLabel     = '';
  genabrBadgeSublabel  = '';
  genabrBadgeLevel: 'moderate' | 'aggressive' = 'moderate';
  genabrBadgeOracle    = false;   // true = Oracle tier is driving the decision
  private _badgeHideTimer: any = null;

  get seekPercent(): number {
    return this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
  }

  constructor(
    private route: ActivatedRoute,
    private videoService: VideoService,
    private cdr: ChangeDetectorRef,
    private telemetry: TelemetryService,
    private prediction: PredictionService,
  ) {}


  ngOnInit(): void {
    const videoId = this.route.snapshot.paramMap.get('id');
    if (videoId) {
      this.loadVideo(videoId);
    } else {
      this.error = 'Video ID not found';
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.destroyHls();
    clearTimeout(this.controlsTimer);
    clearTimeout(this._badgeHideTimer);
    this.predictionSub?.unsubscribe();
    this.telemetry.stopSession();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.showSettingsMenu) this.showSettingsMenu = false;
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen = !!document.fullscreenElement;
    this.cdr.detectChanges();
  }


  loadVideo(videoId: string): void {
    this.loading = true;
    this.error = null;

    this.videoService.getVideoById(videoId).subscribe({
      next: (video: any) => {
        this.video = video;
        if (this.video) {
          this.checkUserAuthentication();
          this.loading = false;
          this.recordWatchHistory(videoId);
          this.doRecordView(videoId);
          // Force Angular to render the *ngIf="video.status === 'ready'" block
          // so <video #videoElement> is in the DOM before HLS.js attaches.
          this.cdr.detectChanges();
          setTimeout(() => this.initHlsPlayer(), 0);
          this.telemetry.startSession(videoId);
        } else {
          this.error = 'Video not found';
          this.loading = false;
        }
      },
      error: (err: any) => {
        console.error('Error loading video:', err);
        this.error = 'Error loading video';
        this.loading = false;
      },
    });
  }


  private initHlsPlayer(): void {
    const videoEl = this.videoRef?.nativeElement;
    if (!videoEl || !this.video?.hlsUrl) return;

    this.destroyHls();

    if (Hls.isSupported()) {
      this.hls = new Hls({
        startLevel:          -1,    // ABR auto-selects quality based on bandwidth
        capLevelToPlayerSize: true, // never fetch higher quality than player dimensions

        // Buffer tuning — HLS.js default is 30s which fires ~5 segment requests
        // upfront. 10s is enough for smooth VOD playback while halving CDN load.
        maxBufferLength:    10,   // target 10s of forward buffer (default: 30)
        maxMaxBufferLength: 30,   // hard cap — never exceed 30s total (default: 600)
        maxBufferSize:      20 * 1000 * 1000, // 20MB cap (default: 60MB)

        // Start playback as soon as the first segment is ready, not after a
        // full buffer fill — reduces perceived time-to-first-frame on mobile.
        maxBufferHole: 0.5,
      });
      this.hls.loadSource(this.video.hlsUrl);
      this.hls.attachMedia(videoEl);

      this.hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
        this.hlsLevels = [
          { name: 'Auto', index: -1 },
          ...data.levels.map((lvl: any, i: number) => ({
            name: lvl.height ? `${lvl.height}p` : `Level ${i}`,
            index: i,
          })),
        ];
        this.hlsCurrentLevel = -1;
        this.cdr.detectChanges();
        // Auto-play when manifest is ready — user navigated here intentionally
        videoEl.play().catch(() => {});
      });

      this.hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        this.hlsAutoLevel = data.level;
        this.cdr.detectChanges();
        // Stamp the switch reason before clearing the flag
        const reason: 'abr_auto' | 'genabr_override' =
          this._genabrForcedLevel ? 'genabr_override' : 'abr_auto';
        this._genabrForcedLevel = false;
        const lvl = this.hls?.levels[data.level];
        if (lvl) this.telemetry.updateBitrate(Math.round(lvl.bitrate / 1000), reason);
      });

      // Subscribe to GenABR buffer targets — apply only when recommendation changes
      this.predictionSub?.unsubscribe();
      this.predictionSub = this.prediction.bufferTargetChanged$.subscribe(target => {
        if (!target || !this.hls) return;

        // 1. Adjust buffer window
        this.hls.config.maxBufferLength    = target.max_buffer_length;
        this.hls.config.maxMaxBufferLength = target.max_max_buffer_length;

        // 2. Proactive quality management ─────────────────────────────────
        // Unlike reactive ABR (which only switches when the buffer empties),
        // GenABR steps quality down immediately when it predicts degradation
        // ahead — demonstrating the core "predictive vs reactive" advantage.
        if (target.recommendation === 'prebuffer_aggressive') {
          this._normalCycleCount = 0;
          // Choose the current playing level: nextAutoLevel when in ABR auto,
          // or currentLevel when manually locked.
          const playingLevel =
            this.hlsCurrentLevel === -1
              ? this.hls.nextAutoLevel
              : this.hls.currentLevel;

          if (playingLevel > 0) {
            // Step down one quality tier and tag the upcoming LEVEL_SWITCHED event
            this._genabrForcedLevel = true;
            this.hls.nextLevel = playingLevel - 1;
          }
        } else if (target.recommendation === 'normal') {
          // Count consecutive normal cycles before releasing the manual lock
          this._normalCycleCount++;
          if (this._normalCycleCount >= this.NORMAL_RELEASE_CYCLES
              && this.hlsCurrentLevel === -1) {
            // Hand control back to HLS.js ABR auto-select
            this.hls.nextLevel = -1;
            this._normalCycleCount = 0;
          }
        } else {
          // Moderate: leave quality where it is, only the buffer window changes
          this._normalCycleCount = 0;
        }
      });

      // Subscribe to full inference result for the activity badge
      this.prediction.inference$.subscribe(result => this.updateGenabrBadge(result));

    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      videoEl.src = this.video.hlsUrl;
      videoEl.play().catch(() => {});
    }
  }

  setQuality(levelIndex: number): void {
    if (!this.hls) return;
    this.hlsCurrentLevel = levelIndex;
    this.hls.currentLevel = levelIndex;  // -1 = ABR auto
  }

  /** Returns the name of the level actually playing in Auto mode */
  getAutoLevelName(): string {
    if (this.hlsAutoLevel === -1) return '';
    const lvl = this.hlsLevels.find(l => l.index === this.hlsAutoLevel);
    return lvl ? lvl.name : '';
  }

  private destroyHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.hlsAutoLevel = -1;
    this.hlsCurrentLevel = -1;
    this.hlsLevels = [];
  }


  togglePlay(): void {
    const v = this.videoRef?.nativeElement;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  }

  onTouchZone(event: TouchEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.vp-controls, .vp-center-btn')) return;

    this._touchHandled = true;
    clearTimeout(this.controlsTimer);

    if (!this.controlsVisible) {
      this.controlsVisible = true;
      if (this.isPlaying) {
        this.controlsTimer = setTimeout(() => {
          this.controlsVisible = false;
          this.cdr.detectChanges();
        }, 3000);
      }
    } else {
      this.controlsVisible = false;
    }
    this.cdr.detectChanges();

    // Synthesised click fires within ~300ms — clear flag after that window
    setTimeout(() => { this._touchHandled = false; }, 400);
  }

  onClickZone(): void {
    if (this._touchHandled) return; // touch already toggled visibility
    clearTimeout(this.controlsTimer);
    if (!this.controlsVisible) {
      this.controlsVisible = true;
      if (this.isPlaying) {
        this.controlsTimer = setTimeout(() => {
          this.controlsVisible = false;
          this.cdr.detectChanges();
        }, 3000);
      }
    } else {
      this.controlsVisible = false;
    }
  }

  toggleMute(): void {
    const v = this.videoRef?.nativeElement;
    if (!v) return;
    v.muted = !v.muted;
  }

  seek(event: Event): void {
    const v = this.videoRef?.nativeElement;
    if (!v) return;
    v.currentTime = +(event.target as HTMLInputElement).value;
  }

  toggleFullscreen(): void {
    const container = this.playerContainerRef?.nativeElement;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }

  onPlayerMouseMove(): void {
    if (this._touchHandled) return; // synthesised mousemove from a touch tap — ignore
    this.controlsVisible = true;
    clearTimeout(this.controlsTimer);
    if (this.isPlaying) {
      this.controlsTimer = setTimeout(() => {
        this.controlsVisible = false;
        this.cdr.detectChanges();
      }, 3000);
    }
  }

  onPlayerMouseLeave(): void {
    if (this.isPlaying) {
      clearTimeout(this.controlsTimer);
      this.controlsTimer = setTimeout(() => {
        this.controlsVisible = false;
        this.cdr.detectChanges();
      }, 800);
    }
  }



  onVideoPlay(): void {
    this.isPlaying = true;
    clearTimeout(this.controlsTimer);
    this.controlsTimer = setTimeout(() => {
      this.controlsVisible = false;
      this.cdr.detectChanges();
    }, 3000);
  }

  onVideoPause(): void {
    this.isPlaying = false;
    this.controlsVisible = true;
    clearTimeout(this.controlsTimer);
  }

  onVideoEnded(): void {
    this.isPlaying = false;
    this.controlsVisible = true;
    clearTimeout(this.controlsTimer);
  }

  onTimeUpdate(): void {
    const v = this.videoRef?.nativeElement;
    if (v) {
      this.currentTime = v.currentTime;
      if (this.hls) {
        const buf = this.hls.mainForwardBufferInfo?.len ?? null;
        if (buf !== null) this.telemetry.updateBufferLevel(buf);
      }
    }
  }

  onLoadedMetadata(): void {
    const v = this.videoRef?.nativeElement;
    if (v) this.duration = v.duration;
  }

  onVolumeChange(): void {
    const v = this.videoRef?.nativeElement;
    if (v) this.isMuted = v.muted;
  }


  private recordWatchHistory(videoId: string): void {
    const userData = localStorage.getItem('user');
    if (!userData) return;
    const user = JSON.parse(userData);
    if (!user?.userId) return;
    this.videoService.addToHistory(videoId, user.userId).subscribe({
      error: (err) => console.error('Failed to record watch history:', err),
    });
  }

  private doRecordView(videoId: string): void {
    this.videoService.recordView(videoId).subscribe({
      next: (res) => { if (res.views > 0) this.video.views = res.views; },
      error: () => {},
    });
  }

  checkUserAuthentication(): void {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        const user = JSON.parse(userData);
        this.currentUserId = user.userId || user._id || null;
        this.isOwner = this.video.user_id === this.currentUserId;
        if (this.currentUserId) this.getUserReaction();
      } catch {
        this.currentUserId = null;
        this.isOwner = false;
      }
    } else {
      this.currentUserId = null;
      this.isOwner = false;
    }
  }

  getUserReaction(): void {
    if (!this.currentUserId || !this.video._id) return;
    this.videoService.getUserReaction(this.video._id).subscribe({
      next: (response) => { this.userReaction = response.reaction as 'liked' | 'disliked' | 'none'; },
      error: () => { this.userReaction = 'none'; },
    });
  }

  onLikeClick(): void {
    if (!this.currentUserId || !this.video._id || this.isLiking) return;
    this.isLiking = true;
    this.videoService.likeVideo(this.video._id).subscribe({
      next: (updatedVideo) => {
        this.video.likes = updatedVideo.likes;
        this.video.dislikes = updatedVideo.dislikes;
        this.userReaction = this.userReaction === 'liked' ? 'none' : 'liked';
        this.isLiking = false;
      },
      error: () => { this.isLiking = false; },
    });
  }

  onDislikeClick(): void {
    if (!this.currentUserId || !this.video._id || this.isDisliking) return;
    this.isDisliking = true;
    this.videoService.dislikeVideo(this.video._id).subscribe({
      next: (updatedVideo) => {
        this.video.likes = updatedVideo.likes;
        this.video.dislikes = updatedVideo.dislikes;
        this.userReaction = this.userReaction === 'disliked' ? 'none' : 'disliked';
        this.isDisliking = false;
      },
      error: () => { this.isDisliking = false; },
    });
  }

  onDeleteClick(): void {
    if (!this.video || !this.isOwner) return;
    if (confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
      const userData = localStorage.getItem('user');
      if (!userData) return;
      const user = JSON.parse(userData);
      this.videoService.deleteVideo(this.video._id, user.userId).subscribe({
        next: () => { window.location.href = '/home'; },
        error: (err) => { console.error('Error deleting video:', err); },
      });
    }
  }


  // ── GenABR badge logic ─────────────────────────────────────────────────────

  private updateGenabrBadge(result: any | null): void {
    if (!result) {
      this.scheduleHideBadge();
      return;
    }

    const rec      = result.buffer_target?.recommendation ?? 'normal';
    const tier     = result.tier_used ?? 'student';
    const pending  = result.oracle_pending ?? false;
    const reason   = result.oracle_reason ?? '';

    if (rec === 'normal') {
      // GenABR returned to normal — linger for a moment then hide
      this.scheduleHideBadge();
      return;
    }

    // Cancel any pending hide timer — GenABR is still active
    clearTimeout(this._badgeHideTimer);
    this._badgeHideTimer = null;

    const isOracle      = tier === 'oracle';
    const isAggressive  = rec === 'prebuffer_aggressive';
    this.genabrBadgeOracle = isOracle;
    this.genabrBadgeLevel  = isAggressive ? 'aggressive' : 'moderate';

    // Main label
    this.genabrBadgeLabel = isOracle ? '🔮 +GenABR AI' : '⚡ +GenABR';

    // Contextual sublabel — pick the most specific reason available
    if (pending) {
      this.genabrBadgeSublabel = 'AI analyzing…';
    } else if (isAggressive && isOracle) {
      this.genabrBadgeSublabel = 'Shielding dead zone';
    } else if (isAggressive) {
      this.genabrBadgeSublabel = 'Boosting buffer';
    } else if (reason.includes('signal_degrading')) {
      this.genabrBadgeSublabel = 'Weak signal detected';
    } else if (reason.includes('highway_speed')) {
      this.genabrBadgeSublabel = 'High-speed mode';
    } else if (reason.includes('peak_hours')) {
      this.genabrBadgeSublabel = 'Peak hours active';
    } else {
      this.genabrBadgeSublabel = 'Pre-buffering ahead';
    }

    this.genabrBadgeVisible = true;
    this.cdr.detectChanges();
  }

  private scheduleHideBadge(): void {
    if (!this.genabrBadgeVisible) return;          // already hidden
    if (this._badgeHideTimer)     return;          // timer already running
    this._badgeHideTimer = setTimeout(() => {
      this.genabrBadgeVisible  = false;
      this._badgeHideTimer     = null;
      this.cdr.detectChanges();
    }, 4_000);
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  retryLoad(): void {
    const videoId = this.route.snapshot.paramMap.get('id');
    if (videoId) this.loadVideo(videoId);
  }

  formatViews(count: number): string {
    if (!count) return '0';
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return count.toLocaleString();
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
