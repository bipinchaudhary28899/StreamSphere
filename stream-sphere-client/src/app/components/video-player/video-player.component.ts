import {
  Component, OnInit, OnDestroy, ElementRef, ViewChild,
  ChangeDetectorRef, HostListener,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { VideoService } from '../../services/video.service';
import { CommentSectionComponent } from '../comment-section/comment-section.component';
import { VideoCardComponent } from '../video-card/video-card.component';
import Hls from 'hls.js';

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatTooltipModule,
    CommentSectionComponent,
    VideoCardComponent,
  ],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css'],
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement',   { static: false }) videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('playerContainer',{ static: false }) playerContainerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('descBody',       { static: false }) descBodyRef?: ElementRef<HTMLElement>;
  @ViewChild('aiBody',         { static: false }) aiBodyRef?: ElementRef<HTMLElement>;

  video: any = null;
  loading = true;
  error: string | null = null;
  isOwner = false;
  descOpen = false;
  aiSummaryOpen = false;
  /** Only offer "more" when the collapsed text actually overflows. */
  descOverflows = false;
  aiOverflows = false;
  currentUserId: string | null = null;
  userReaction: 'liked' | 'disliked' | 'none' = 'none';
  isLiking = false;
  isDisliking = false;

  /** Video id currently on screen; the component is reused across /video/:id. */
  private currentVideoId: string | null = null;
  private subs = new Subscription();

  /** True once HLS has been attached for the current hlsUrl, so the background
   *  API refresh does not tear down and restart a player that is already going. */
  private hlsStartedFor: string | null = null;
  /** Guards the deferred side-effect block so it runs exactly once per view. */
  private sideEffectsDone = false;
  /** Fallback timer that fires the side effects even if `canplay` never does
   *  (autoplay blocked, decode error, offline) — views must still be recorded. */
  private sideEffectsTimer: any = null;
  /** Gates <app-comment-section> and Up next so their API calls cannot compete
   *  with the manifest and first segment for bandwidth. */
  commentsReady = false;

  // ── Up next ────────────────────────────────────────────────────────────────
  upNext: any[] = [];
  upNextLoading = false;
  readonly upNextSkeletons = [0, 1, 2, 3, 4, 5];

  private hls: Hls | null = null;
  hlsLevels: Array<{ name: string; index: number }> = [];
  hlsCurrentLevel = -1;
  hlsAutoLevel = -1;
  showSettingsMenu = false;

  // ── Playback state ─────────────────────────────────────────────────────────
  isPlaying = false;
  hasPlayed = false;
  isBuffering = false;
  isMuted = false;
  volume = 1;
  currentTime = 0;
  duration = 0;
  bufferedEnd = 0;
  controlsVisible = true;
  isFullscreen = false;
  /** Touch devices tap to reveal controls; mice click to play/pause. */
  readonly isTouch = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches;
  private controlsTimer: any = null;
  // Blocks the synthesised click/mousemove that follows a touch tap.
  private _touchHandled = false;

  /** Short-lived feedback bubble for clicks and keyboard shortcuts. */
  flash: { icon: string; label?: string } | null = null;
  private flashTimer: any = null;

  toast: string | null = null;
  toastIsError = false;
  private toastTimer: any = null;

  get seekPercent(): number {
    return this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
  }

  get bufferedPercent(): number {
    return this.duration > 0 ? Math.min(100, (this.bufferedEnd / this.duration) * 100) : 0;
  }

  /** Big centre button: while paused, or on touch screens whenever controls show. */
  get showCenterButton(): boolean {
    // Not while buffering, or while the quality menu is open over it
    if (this.isBuffering || this.showSettingsMenu) return false;
    return !this.isPlaying || (this.isTouch && this.controlsVisible);
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private videoService: VideoService,
    private cdr: ChangeDetectorRef,
  ) {}


  ngOnInit(): void {
    // paramMap (not the snapshot) so Up next can switch videos in place.
    this.subs.add(
      this.route.paramMap.subscribe(params => this.openVideo(params.get('id'))),
    );
  }

  ngOnDestroy(): void {
    // Late responses check this id, so they stop once the page is gone
    this.currentVideoId = null;
    this.subs.unsubscribe();
    this.destroyHls();
    clearTimeout(this.controlsTimer);
    clearTimeout(this.sideEffectsTimer);
    clearTimeout(this.flashTimer);
    clearTimeout(this.toastTimer);
  }

  private openVideo(videoId: string | null): void {
    if (!videoId) {
      this.error = 'Video ID not found';
      this.loading = false;
      return;
    }
    if (videoId === this.currentVideoId) return;
    if (this.currentVideoId !== null) this.resetForNewVideo();
    this.currentVideoId = videoId;

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

  /** Clears everything tied to the previous video before showing the next. */
  private resetForNewVideo(): void {
    this.destroyHls();
    this.hlsStartedFor = null;
    clearTimeout(this.sideEffectsTimer);
    this.sideEffectsTimer = null;
    this.sideEffectsDone = false;
    this.commentsReady = false;
    this.video = null;
    this.loading = true;
    this.error = null;
    this.isOwner = false;
    this.userReaction = 'none';
    this.isLiking = this.isDisliking = false;
    this.isPlaying = this.hasPlayed = this.isBuffering = false;
    this.currentTime = this.duration = this.bufferedEnd = 0;
    this.descOpen = this.aiSummaryOpen = false;
    this.descOverflows = this.aiOverflows = false;
    this.showSettingsMenu = false;
    this.controlsVisible = true;
    this.upNext = [];
    this.upNextLoading = false;
    this.creatorAvatarFailed = false;
    clearTimeout(this.controlsTimer);
    window.scrollTo({ top: 0 });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (!this.showSettingsMenu) return;
    this.showSettingsMenu = false;
    this.revealControls(); // restart the auto-hide that was paused for the menu
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen = !!document.fullscreenElement;
    this.cdr.detectChanges();
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const v = this.videoRef?.nativeElement;
    if (!v || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    // Not while a menu or dialog is open (they render in the overlay container)
    if (target?.closest('.cdk-overlay-container') || document.querySelector('.cdk-overlay-backdrop')) return;
    // Buttons handle Space/Enter themselves.
    if ((event.key === ' ' || event.key === 'Enter') && target?.tagName === 'BUTTON') return;

    switch (event.key) {
      case ' ':
      case 'k':
      case 'K':
        event.preventDefault();
        this.togglePlay(true);
        break;
      case 'm':
      case 'M':
        this.toggleMute();
        this.showFlash(v.muted ? 'volume_off' : 'volume_up');
        break;
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
      case 'ArrowLeft':
      case 'j':
      case 'J':
        event.preventDefault();
        this.skip(event.key === 'ArrowLeft' ? -5 : -10);
        break;
      case 'ArrowRight':
      case 'l':
      case 'L':
        event.preventDefault();
        this.skip(event.key === 'ArrowRight' ? 5 : 10);
        break;
      default:
        return;
    }
    this.revealControls();
  }

  loadVideo(videoId: string): void {
    // Only show the spinner when nothing is on screen yet. If router state
    // already gave us a video, this refresh happens silently underneath.
    if (!this.video) this.loading = true;
    this.error = null;

    this.videoService.getVideoById(videoId).subscribe({
      next: (video: any) => {
        if (videoId !== this.currentVideoId) return;   // user moved on
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
        this.measureOverflow();
        // No-op when openVideo() already started this exact stream.
        setTimeout(() => this.initHlsPlayer(), 0);
        this.armSideEffects(videoId);
      },
      error: (err: any) => {
        if (videoId !== this.currentVideoId) return;
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
      if (this.sideEffectsDone || videoId !== this.currentVideoId) return;
      this.sideEffectsDone = true;
      clearTimeout(this.sideEffectsTimer);
      this.sideEffectsTimer = null;

      this.recordWatchHistory(videoId);
      this.doRecordView(videoId);
      if (this.currentUserId) this.getUserReaction();
      this.commentsReady = true;
      this.loadUpNext(videoId);
      this.cdr.detectChanges();
    };

    const el = this.videoRef?.nativeElement;
    // canplay may already have fired (e.g. playback started from router state
    // before this metadata response arrived); don't wait for the backstop then.
    if (el && el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      run();
      return;
    }
    el?.addEventListener('canplay', run, { once: true });
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

    // Idempotent: openVideo() may have already started this exact stream from
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
          ...data.levels
            .map((lvl: any, i: number) => ({
              name: lvl.height ? `${lvl.height}p` : `Level ${i}`,
              height: lvl.height || 0,
              index: i,
            }))
            // Highest quality first, as players usually list them
            .sort((a: any, b: any) => b.height - a.height)
            .map(({ name, index }: any) => ({ name, index })),
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

  /** Label for the quality button: "Auto", or the level the viewer picked. */
  get qualityLabel(): string {
    if (this.hlsCurrentLevel === -1) return this.getAutoLevelName() || 'Auto';
    return this.hlsLevels.find(l => l.index === this.hlsCurrentLevel)?.name || 'Auto';
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

  // ── Controls ───────────────────────────────────────────────────────────────

  togglePlay(withFeedback = false): void {
    const v = this.videoRef?.nativeElement;
    if (!v) return;
    if (v.paused || v.ended) {
      v.play().catch(() => {});
      if (withFeedback) this.showFlash('play_arrow');
    } else {
      v.pause();
      if (withFeedback) this.showFlash('pause');
    }
  }

  skip(seconds: number): void {
    const v = this.videoRef?.nativeElement;
    if (!v || !isFinite(v.duration)) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + seconds), v.duration);
    this.currentTime = v.currentTime;
    this.showFlash(seconds < 0 ? 'fast_rewind' : 'fast_forward', `${Math.abs(seconds)}s`);
  }

  private showFlash(icon: string, label?: string): void {
    clearTimeout(this.flashTimer);
    // Drop the old bubble first so its animation restarts.
    this.flash = null;
    this.cdr.detectChanges();
    this.flash = { icon, label };
    this.flashTimer = setTimeout(() => {
      this.flash = null;
      this.cdr.detectChanges();
    }, 650);
  }

  private revealControls(): void {
    this.controlsVisible = true;
    clearTimeout(this.controlsTimer);
    if (this.isPlaying) {
      this.controlsTimer = setTimeout(() => {
        // Keep the controls up while a quality is being chosen
        if (this.showSettingsMenu) return;
        this.controlsVisible = false;
        this.cdr.detectChanges();
      }, 3000);
    }
  }

  toggleSettingsMenu(event: Event): void {
    event.stopPropagation();
    this.showSettingsMenu = !this.showSettingsMenu;
    // Opening keeps the controls up (the auto-hide skips while the menu is open)
    this.revealControls();
  }

  chooseQuality(levelIndex: number, event: Event): void {
    event.stopPropagation();
    this.setQuality(levelIndex);
    this.showSettingsMenu = false;
    this.revealControls();
  }

  onTouchZone(event: TouchEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.vp-controls, .vp-center-btn')) return;

    this._touchHandled = true;
    clearTimeout(this.controlsTimer);

    if (!this.controlsVisible) {
      this.revealControls();
    } else {
      this.controlsVisible = false;
      this.showSettingsMenu = false;
    }
    this.cdr.detectChanges();

    // Synthesised click fires within ~300ms — clear flag after that window
    setTimeout(() => { this._touchHandled = false; }, 400);
  }

  /** Mouse click on the picture plays or pauses, as on other video sites. */
  onClickZone(): void {
    if (this._touchHandled) return; // touch already toggled visibility
    if (this.showSettingsMenu) {
      this.showSettingsMenu = false;
      this.revealControls();
      return;
    }
    this.togglePlay(true);
    this.revealControls();
  }

  onDoubleClickZone(): void {
    if (this._touchHandled) return;
    this.toggleFullscreen();
  }

  toggleMute(): void {
    const v = this.videoRef?.nativeElement;
    if (!v) return;
    // Unmuting at zero volume would stay silent, so restore a usable level.
    if (v.muted && v.volume === 0) v.volume = 0.5;
    v.muted = !v.muted;
  }

  setVolume(event: Event): void {
    const v = this.videoRef?.nativeElement;
    if (!v) return;
    const value = +(event.target as HTMLInputElement).value;
    v.volume = value;
    v.muted = value === 0;
  }

  seek(event: Event): void {
    const v = this.videoRef?.nativeElement;
    if (!v) return;
    v.currentTime = +(event.target as HTMLInputElement).value;
    this.currentTime = v.currentTime;
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
    this.revealControls();
  }

  onPlayerMouseLeave(): void {
    if (this.isPlaying && !this.showSettingsMenu) {
      clearTimeout(this.controlsTimer);
      this.controlsTimer = setTimeout(() => {
        this.controlsVisible = false;
        this.cdr.detectChanges();
      }, 800);
    }
  }

  onVideoPlay(): void {
    this.isPlaying = true;
    this.hasPlayed = true;
    this.revealControls();
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

  onWaiting(): void {
    this.isBuffering = true;
  }

  onPlaying(): void {
    this.isBuffering = false;
  }

  onTimeUpdate(): void {
    const v = this.videoRef?.nativeElement;
    if (!v) return;
    this.currentTime = v.currentTime;
    this.updateBuffered(v);
  }

  onProgress(): void {
    const v = this.videoRef?.nativeElement;
    if (v) this.updateBuffered(v);
  }

  /** End of the buffered range that contains the playhead. */
  private updateBuffered(v: HTMLVideoElement): void {
    const ranges = v.buffered;
    let end = 0;
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= v.currentTime + 0.5 && ranges.end(i) >= v.currentTime) {
        end = ranges.end(i);
        break;
      }
    }
    this.bufferedEnd = end;
  }

  onLoadedMetadata(): void {
    const v = this.videoRef?.nativeElement;
    if (v) this.duration = v.duration;
  }

  onVolumeChange(): void {
    const v = this.videoRef?.nativeElement;
    if (!v) return;
    this.isMuted = v.muted;
    this.volume = v.muted ? 0 : v.volume;
  }

  get volumeIcon(): string {
    if (this.isMuted || this.volume === 0) return 'volume_off';
    return this.volume < 0.5 ? 'volume_down' : 'volume_up';
  }

  // ── Side effects ───────────────────────────────────────────────────────────

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
      next: (res) => {
        if (res.views > 0 && this.video?._id === videoId) this.video.views = res.views;
      },
      error: () => {},
    });
  }

  /** Other videos to keep watching: same category first, then the latest feed. */
  private loadUpNext(videoId: string): void {
    this.upNextLoading = true;
    const category = this.video?.category;
    const keep = (list: any[]) =>
      (list || []).filter(v => v?._id && v._id !== videoId && (v.status ?? 'ready') === 'ready');

    this.videoService.getFeed(undefined, category || undefined).subscribe({
      next: (page) => {
        if (videoId !== this.currentVideoId) return;
        const sameCategory = keep(page.videos);
        if (sameCategory.length >= 6 || !category) {
          this.upNext = sameCategory.slice(0, 12);
          this.upNextLoading = false;
          return;
        }
        // Not enough in this category — top up with the latest videos.
        this.videoService.getFeed().subscribe({
          next: (latest) => {
            if (videoId !== this.currentVideoId) return;
            const seen = new Set(sameCategory.map(v => v._id));
            this.upNext = [...sameCategory, ...keep(latest.videos).filter(v => !seen.has(v._id))].slice(0, 12);
            this.upNextLoading = false;
          },
          error: () => {
            if (videoId !== this.currentVideoId) return;
            this.upNext = sameCategory;
            this.upNextLoading = false;
          },
        });
      },
      error: () => {
        if (videoId === this.currentVideoId) this.upNextLoading = false;
      },
    });
  }

  trackById(_: number, video: any): string {
    return video._id;
  }

  getUserReaction(): void {
    if (!this.currentUserId || !this.video._id) return;
    const videoId = this.video._id;
    this.videoService.getUserReaction(videoId).subscribe({
      next: (response) => {
        if (videoId === this.currentVideoId) this.userReaction = response.reaction as 'liked' | 'disliked' | 'none';
      },
      error: () => {
        if (videoId === this.currentVideoId) this.userReaction = 'none';
      },
    });
  }

  onLikeClick(): void {
    if (!this.currentUserId || !this.video._id || this.isLiking) return;
    const videoId = this.video._id;
    this.isLiking = true;
    this.videoService.likeVideo(videoId).subscribe({
      next: (updatedVideo) => {
        if (videoId !== this.currentVideoId) return; // user switched videos
        this.video.likes = updatedVideo.likes;
        this.video.dislikes = updatedVideo.dislikes;
        this.userReaction = this.userReaction === 'liked' ? 'none' : 'liked';
        this.isLiking = false;
      },
      error: () => {
        if (videoId !== this.currentVideoId) return;
        this.isLiking = false;
        this.showToast('Couldn’t save your like. Try again.', true);
      },
    });
  }

  onDislikeClick(): void {
    if (!this.currentUserId || !this.video._id || this.isDisliking) return;
    const videoId = this.video._id;
    this.isDisliking = true;
    this.videoService.dislikeVideo(videoId).subscribe({
      next: (updatedVideo) => {
        if (videoId !== this.currentVideoId) return; // user switched videos
        this.video.likes = updatedVideo.likes;
        this.video.dislikes = updatedVideo.dislikes;
        this.userReaction = this.userReaction === 'disliked' ? 'none' : 'disliked';
        this.isDisliking = false;
      },
      error: () => {
        if (videoId !== this.currentVideoId) return;
        this.isDisliking = false;
        this.showToast('Couldn’t save your rating. Try again.', true);
      },
    });
  }

  async share(): Promise<void> {
    const url = `${window.location.origin}/video/${this.video?._id}`;
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share && this.isTouch) {
      try {
        await nav.share({ title: this.video?.title, url });
        return;
      } catch {
        // Cancelled or unavailable — fall back to copying the link.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      this.showToast('Link copied');
    } catch {
      this.showToast('Couldn’t copy the link. Copy it from the address bar.', true);
    }
  }

  private showToast(message: string, isError = false): void {
    clearTimeout(this.toastTimer);
    this.toast = message;
    this.toastIsError = isError;
    this.cdr.detectChanges();
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.cdr.detectChanges();
    }, 3000);
  }

  onDeleteClick(): void {
    if (!this.video || !this.isOwner) return;
    if (confirm('Delete this video? This can’t be undone.')) {
      const userData = localStorage.getItem('user');
      if (!userData) return;
      const user = JSON.parse(userData);
      this.videoService.deleteVideo(this.video._id, user.userId).subscribe({
        next: () => {
          this.videoService.triggerFeedRefresh();
          this.router.navigate(['/home']);
        },
        error: (err) => {
          console.error('Error deleting video:', err);
          this.showToast('Couldn’t delete the video. Try again.', true);
        },
      });
    }
  }

  // ── Description ────────────────────────────────────────────────────────────

  toggleDescription(): void {
    this.descOpen = !this.descOpen;
    if (!this.descOpen) this.measureOverflow();
  }

  toggleAiSummary(): void {
    this.aiSummaryOpen = !this.aiSummaryOpen;
    if (!this.aiSummaryOpen) this.measureOverflow();
  }

  /**
   * Checks whether the collapsed description / AI summary are cut off.
   * An expanded panel isn't measured: it never overflows, and measuring it
   * would hide its "Show less" button.
   */
  private measureOverflow(): void {
    setTimeout(() => {
      let changed = false;
      const d = this.descBodyRef?.nativeElement;
      if (!this.descOpen) {
        const desc = !!d && d.scrollHeight > d.clientHeight + 2;
        if (desc !== this.descOverflows) { this.descOverflows = desc; changed = true; }
      }
      const a = this.aiBodyRef?.nativeElement;
      if (!this.aiSummaryOpen) {
        const ai = !!a && a.scrollHeight > a.clientHeight + 2;
        if (ai !== this.aiOverflows) { this.aiOverflows = ai; changed = true; }
      }
      if (changed) this.cdr.detectChanges();
    });
  }

  @HostListener('window:resize')
  onResize(): void {
    this.measureOverflow();
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  timeAgo(value: string | undefined | null): string {
    if (!value) return '';
    const then = new Date(value).getTime();
    if (isNaN(then)) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
    const units: Array<[number, string]> = [
      [31_536_000, 'year'], [2_592_000, 'month'], [604_800, 'week'],
      [86_400, 'day'], [3_600, 'hour'], [60, 'minute'],
    ];
    for (const [size, name] of units) {
      const n = Math.floor(seconds / size);
      if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
    return 'Just now';
  }

  retryLoad(): void {
    const videoId = this.route.snapshot.paramMap.get('id');
    if (videoId) {
      this.currentVideoId = videoId;
      this.loadVideo(videoId);
    }
  }

  formatViews(count: number): string {
    if (!count) return '0';
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return count.toLocaleString();
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ss = s.toString().padStart(2, '0');
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  get creatorInitial(): string {
    return ((this.video?.userName || 'U').trim()[0] || 'U').toUpperCase();
  }

  creatorAvatarFailed = false;
}
