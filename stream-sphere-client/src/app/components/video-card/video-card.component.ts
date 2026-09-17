import {
  Component, Input, OnInit, OnChanges, OnDestroy, Output, EventEmitter,
  ChangeDetectorRef, SimpleChanges,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MediaManagerService } from '../../services/media-manager.service';

@Component({
  selector: 'app-video-card',
  templateUrl: './video-card.component.html',
  styleUrls: ['./video-card.component.scss'],
  standalone: true,
  imports: [CommonModule, MatIconModule, RouterLink],
})
export class VideoCardComponent implements OnInit, OnChanges, OnDestroy {
  @Input() video: any;
  /** Shows the info button that reveals the description over the thumbnail. */
  @Input() flipEnabled: boolean = true;
  @Input() faded: boolean = false;
  /** 'grid' for feeds, 'compact' for side lists such as Up next. */
  @Input() layout: 'grid' | 'compact' = 'grid';
  @Output() videoDeleted = new EventEmitter<string>();
  safeUrl: any;
  /** Cached so change detection sees stable references. */
  link: any[] | null = null;
  linkState: { video: any } | undefined = undefined;
  currentUserId: string | null = null;
  isOwner: boolean = false;
  /** Description panel open over the thumbnail. */
  flip = false;
  avatarFailed = false;
  previewLoaded    = false;  // true once the hover delay fires — lazy-loads the video src
  isPreviewPlaying = false;  // true while the preview video is active (thumbnail fades out)
  private previewDelayTimer: any = null;
  private hoverActive = false;

  constructor(
    private sanitizer: DomSanitizer,
    private router: Router,
    private mediaManager: MediaManagerService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    if (!this.video) {
      console.error('No video data provided to video card component');
      return;
    }
    this.setup();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Cards can be re-bound to another video (e.g. a reused list slot).
    if (changes['video'] && !changes['video'].firstChange && this.video) {
      this.previewLoaded = false;
      this.isPreviewPlaying = false;
      this.avatarFailed = false;
      this.flip = false;
      this.setup();
    }
  }

  private setup(): void {
    this.link = this.video._id ? ['/video', this.video._id] : null;
    this.linkState = { video: this.video };
    // Only use previewUrl — S3_url (raw file) is deleted after transcoding.
    // If previewUrl is absent the hover just shows the thumbnail with no video.
    const previewSrc = this.video.previewUrl ?? null;
    this.safeUrl = previewSrc
      ? this.sanitizer.bypassSecurityTrustResourceUrl(previewSrc)
      : null;
    const userData = localStorage.getItem('user');
    if (userData) {
      const user = JSON.parse(userData);
      this.currentUserId = user.userId;
      this.isOwner = this.video.user_id === user.userId;
    } else {
      this.currentUserId = null;
      this.isOwner = false;
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.previewDelayTimer);
    // A card removed mid-hover (feed refresh) must not leave the hero paused.
    if (this.hoverActive) this.mediaManager.cardHoverEnd();
  }

  onVideoClick() {
    if (this.video && this.video._id) {
      // Hand the already-loaded video object to the player via router state so
      // it can start HLS immediately instead of waiting a full API round trip
      // for data we are already holding. The player still refetches in the
      // background, and falls back to the API when state is absent (deep link,
      // reload, back/forward navigation).
      this.router.navigate(['/video', this.video._id], { state: { video: this.video } });
    }
  }

  onDeleteClick(event: Event) {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
      this.deleteVideo();
    }
  }

  onFlipClick(event: Event) {
    event.stopPropagation();
    event.preventDefault?.();
    this.flip = !this.flip;
  }

  onThumbHover(event: MouseEvent): void {
    if (!this.safeUrl || this.flip) return;   // no preview, or the description is open
    const thumbWrap = event.currentTarget as HTMLElement;
    this.hoverActive = true;
    this.mediaManager.cardHoverStart();   // pause the hero carousel

    // Wait 1 s before starting the preview so brief mouseovers don't trigger it
    this.previewDelayTimer = setTimeout(() => {
      // Don't fade the thumbnail yet — wait until the video has a frame ready
      if (!this.previewLoaded) {
        // First time — inject <source>, let Angular render it, then play
        this.previewLoaded = true;
        this.cdr.detectChanges();
        setTimeout(() => this.playPreview(thumbWrap), 50);
      } else {
        this.playPreview(thumbWrap);
      }
    }, 1000);
  }

  onThumbLeave(event: MouseEvent): void {
    // Cancel the pending delay if the user left before it fired
    clearTimeout(this.previewDelayTimer);
    this.previewDelayTimer = null;
    this.isPreviewPlaying = false;        // thumbnail cover fades back in

    const thumbWrap = event.currentTarget as HTMLElement;
    const video = thumbWrap.querySelector<HTMLVideoElement>('video.video-preview');
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    if (this.hoverActive) {
      this.hoverActive = false;
      this.mediaManager.cardHoverEnd();   // allow the hero carousel to resume
    }
  }

  private playPreview(thumbWrap: HTMLElement): void {
    const video = thumbWrap.querySelector<HTMLVideoElement>('video.video-preview');
    if (!video || !this.hoverActive) return;

    // Set muted as a DOM property — the HTML attribute alone is unreliable in some browsers
    video.muted = true;

    // REQUIRED: when <source> is injected dynamically via *ngIf, the browser
    // does not automatically detect the new source. load() re-scans child
    // <source> elements so the browser registers the URL before play() fires.
    video.load();

    video.play()
      .then(() => {
        // play() resolves once the first frame is committed — safe to fade now
        if (!this.hoverActive) { video.pause(); return; }
        this.isPreviewPlaying = true;
        this.cdr.detectChanges();
      })
      .catch(() => {
        // Autoplay blocked or bad src — keep thumbnail visible, do nothing
      });
  }

  deleteVideo() {
    if (!this.currentUserId || !this.video._id) return;
    this.videoDeleted.emit(this.video._id);
  }

  onAvatarError(event: Event): void {
    // Hide the broken image and show the initials avatar instead
    (event.target as HTMLImageElement).style.display = 'none';
    this.avatarFailed = true;
  }

  get initial(): string {
    return ((this.video?.userName || 'U').trim()[0] || 'U').toUpperCase();
  }

  formatViews(count: number): string {
    if (!count) return '0';
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return count.toLocaleString();
  }

  /** "3 days ago" style relative time; empty when the date is missing or invalid. */
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
}
