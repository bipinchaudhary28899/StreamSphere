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

  /** True once HLS has been attached for the current hlsUrl, so the background
   *  API refresh does not tear down and restart a player that is already going. */
  private hlsStartedFor: string | null = null;
  /** Guards the deferred side-effect block so it runs exactly once per view. */
  private sideEffectsDone = false;
  /** Fallback timer that fires the side effects even if `canplay` never does
   *  (autoplay blocked, decode error, offline) — views must still be recorded. */
  private sideEffectsTimer: any = null;
  /** Gates <app-comment-section> so its API call cannot compete with the
   *  manifest and first segment for bandwidth. */
  commentsReady = false;

  private hls: Hls | null = null;
  hlsLevels: Array<{ name: string; index: number }> = [];
  hlsCurrentLevel = -1;
  hlsAutoLevel = -1;
  showSettingsMenu = false;

  isPlaying = false;
  isMuted = false;
  currentTime = 0;
  duration = 0;
  controlsVisible = true;
  isFullscreen = false;
  private controlsTimer: any = null;
  // Blocks the synthesised click/mousemove that follows a touch tap.
  private _touchHandled = false;

  get seekPercent(): number {
    return this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
  }

  constructor(
    private route: ActivatedRoute,
    private videoService: VideoService,
    private cdr: ChangeDetectorRef,
  ) {}


  ngOnInit(): void {
    const videoId = this.route.snapshot.paramMap.get('id');
    if (!videoId) {
      this.error = 'Video ID not found';
      this.loading = false;
      return;
    }

    // When we arrived from a feed card the whole video object — hlsUrl included
    // — was handed over in router state. Start playback off that immediately;
    // waiting for getVideoById() costs a full round trip (measured at 1.2s on a
    // cold serverless start) before the first manifest byte is even requested.
    const handed = history.state?.video;
    if (handed?._id === videoId && handed.hlsUrl && handed.status === 'ready') {
      this.video = handed;
      this.loading = false;
      this.applyOwnership();
      this.cdr.detectChanges();          // render <video> before HLS attaches
      setTimeout(() => this.initHlsPlayer(), 0);
    }

    // Always refetch: router state can be stale, and it is absent entirely on a
    // deep link or reload. This only replaces metadata — if HLS is already
    // running on the same URL it is left untouched.
    this.loadVideo(videoId);
  }

  ngOnDestroy(): void {
    this.destroyHls();
    clearTimeout(this.controlsTimer);
    clearTimeout(this.sideEffectsTimer);
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
    // Only show the spinner when nothing is on screen yet. If router state
    // already gave us a video, this refresh happens silently underneath.
    if (!this.video) this.loading = true;
    this.error = null;

    this.videoService.getVideoById(videoId).subscribe({
      next: (video: any) => {
        if (!video) {
          if (!this.video) { this.error = 'Video not found'; this.loading = false; }
          return;
        }
        this.video = video;
        this.loading = false;
        this.applyOwnership();
        // Force Angular to render the *ngIf="video.status === 'ready'" block
        // so <video #videoElement> is in the DOM before HLS.js attaches.
        this.cdr.detectChanges();
        // No-op when ngOnInit already started this exact stream.
        setTimeout(() => this.initHlsPlayer(), 0);
        this.armSideEffects(videoId);
      },
      error: (err: any) => {
        console.error('Error loading video:', err);
        // A failed refresh must not kill a stream that is already playing.
        if (!this.video) {
          this.error = 'Error loading video';
          this.loading = false;
        }
      },
    });
  }


  /**
   * Fire the non-critical requests only once the player has enough data to
   * paint a frame. Previously /history, /view, /reaction and the comment
   * section all launched in the same tick as the manifest fetch and
   * competed with it for connections and bandwidth — measured at 522–840ms
   * each, right through the window that decides time-to-first-frame.
   *
   * `canplay` is the trigger rather than `playing` because it fires even when
   * autoplay is blocked. The timer is a backstop so a video that never becomes
   * playable still records its view.
   */
  private armSideEffects(videoId: string): void {
    if (this.sideEffectsDone || this.sideEffectsTimer) return;

    const run = () => {
      if (this.sideEffectsDone) return;
      this.sideEffectsDone = true;
      clearTimeout(this.sideEffectsTimer);
      this.sideEffectsTimer = null;

      this.recordWatchHistory(videoId);
      this.doRecordView(videoId);
      if (this.currentUserId) this.getUserReaction();
      this.commentsReady = true;
      this.cdr.detectChanges();
    };

    this.videoRef?.nativeElement.addEventListener('canplay', run, { once: true });
    this.sideEffectsTimer = setTimeout(run, 3000);
  }


  /** Ownership/identity from localStorage only — no network call, so it is safe
   *  to run on the critical path. The /reaction fetch is deferred separately. */
  private applyOwnership(): void {
    const userData = localStorage.getItem('user');
    if (!userData) { this.currentUserId = null; this.isOwner = false; return; }
    try {
      const user = JSON.parse(userData);
      this.currentUserId = user.userId || user._id || null;
      this.isOwner = this.video?.user_id === this.currentUserId;
    } catch {
      this.currentUserId = null;
      this.isOwner = false;
    }
  }


  private initHlsPlayer(): void {
    const videoEl = this.videoRef?.nativeElement;
    if (!videoEl || !this.video?.hlsUrl) return;

    // Idempotent: ngOnInit may have already started this exact stream from
    // router state, and the background refresh must not restart it.
    if (this.hlsStartedFor === this.video.hlsUrl) return;
    this.hlsStartedFor = this.video.hlsUrl;

    this.destroyHls();

    if (Hls.isSupported()) {
      this.hls = new Hls({
        startLevel:          -1,    // ABR auto-selects quality based on bandwidth
        capLevelToPlayerSize: true, // never fetch higher quality than player dimensions

        // Skip the bandwidth-probe fragment. With this on (the default) hls.js
        // downloads fragment 0 at the lowest level purely to measure the link,
        // then immediately refetches the SAME fragment at the level it settles
        // on — measured here as 360p_000.ts (1.1MB) followed by 1080p_000.ts
        // (3.6MB) for one segment of playback, all on the critical path.
        testBandwidth: false,
        // With the probe gone the first level is picked from this estimate, so
        // the stock 500kbps is too pessimistic. 1Mbps sits between the 360p
        // (896kbps) and 720p (2.9Mbps) rungs: start at 360p for a fast first
        // frame, then let ABR climb from segment 1 on real measurements.
        abrEwmaDefaultEstimate: 1_000_000,

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
      });

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
    if (v) this.currentTime = v.currentTime;
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
