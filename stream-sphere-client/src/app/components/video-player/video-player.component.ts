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

  // ── Video data ────────────────────────────────────────────────────────────
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

  // ── HLS quality switcher ──────────────────────────────────────────────────
  private hls: Hls | null = null;
  hlsLevels: Array<{ name: string; index: number }> = [];
  hlsCurrentLevel = -1;
  hlsAutoLevel = -1;
  showSettingsMenu = false;

  // ── Custom controls state ─────────────────────────────────────────────────
  isPlaying = false;
  isMuted = false;
  currentTime = 0;
  duration = 0;
  controlsVisible = true;
  isFullscreen = false;
  private controlsTimer: any = null;

  get seekPercent(): number {
    return this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
  }

  constructor(
    private route: ActivatedRoute,
    private videoService: VideoService,
    private cdr: ChangeDetectorRef,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

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
  }

  // ── Close settings menu when clicking outside the player ─────────────────
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.showSettingsMenu) this.showSettingsMenu = false;
  }

  // ── Track browser fullscreen changes ──────────────────────────────────────
  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen = !!document.fullscreenElement;
    this.cdr.detectChanges();
  }

  // ── Data loading ──────────────────────────────────────────────────────────

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

  // ── HLS player ────────────────────────────────────────────────────────────

  private initHlsPlayer(): void {
    const videoEl = this.videoRef?.nativeElement;
    if (!videoEl || !this.video?.hlsUrl) return;

    this.destroyHls();

    if (Hls.isSupported()) {
      this.hls = new Hls({ startLevel: -1, capLevelToPlayerSize: true });
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

  // ── Custom player controls ────────────────────────────────────────────────

  togglePlay(): void {
    const v = this.videoRef?.nativeElement;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  }

  /**
   * Clicking the transparent video area (not on a control):
   *  - If controls are hidden  → reveal them (auto-hide again if playing)
   *  - If controls are visible → hide them immediately
   */
  onClickZone(): void {
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


  // ── Video element event handlers ──────────────────────────────────────────

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

  // ── Auth / view helpers ───────────────────────────────────────────────────

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

  // ── Formatters ────────────────────────────────────────────────────────────

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
