import { Component, Input, OnInit, Output, EventEmitter } from '@angular/core';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MediaManagerService } from '../../services/media-manager.service';

@Component({
  selector: 'app-video-card',
  templateUrl: './video-card.component.html',
  styleUrls: ['./video-card.component.scss'],
  standalone: true,
  imports: [MatCardContent, MatCard, CommonModule, MatButtonModule, MatIconModule]
})
export class VideoCardComponent implements OnInit {
  @Input() video: any;
  @Input() flipEnabled: boolean = true;
  @Input() faded: boolean = false;
  @Output() videoDeleted = new EventEmitter<string>();
  safeUrl: any;
  currentUserId: string | null = null;
  isOwner: boolean = false;
  flip = false;
  previewLoaded    = false;  // true once the 2s delay fires — lazy-loads the video src
  isPreviewPlaying = false;  // true while the preview video is active (thumbnail fades out)
  private previewDelayTimer: any = null;

  constructor(
    private sanitizer: DomSanitizer,
    private router: Router,
    private mediaManager: MediaManagerService,
  ) {}

  ngOnInit() {
    if (!this.video) {
      console.error('No video data provided to video card component');
      return;
    }
    // Only use previewUrl — S3_url (raw file) is deleted after transcoding.
    // If previewUrl is absent the hover just shows the thumbnail overlay with no video.
    const previewSrc = this.video.previewUrl ?? null;
    this.safeUrl = previewSrc
      ? this.sanitizer.bypassSecurityTrustResourceUrl(previewSrc)
      : null;
    const userData = localStorage.getItem('user');
    if (userData) {
      const user = JSON.parse(userData);
      this.currentUserId = user.userId;
      this.isOwner = this.video.user_id === user.userId;
    }
  }

  get safeVideoUrl(): string {
    return this.video?.S3_url || '';
  }

  onVideoClick() {
    if (this.video && this.video._id) {
      this.router.navigate(['/video', this.video._id]);
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
    this.flip = !this.flip;
  }

  onThumbHover(event: MouseEvent): void {
    if (!this.safeUrl) return;            // no preview available — skip entirely
    const thumbWrap = event.currentTarget as HTMLElement;
    this.mediaManager.cardHoverStart();   // pause the hero carousel

    // Wait 2 s before starting the preview so brief mouseovers don't trigger it
    this.previewDelayTimer = setTimeout(() => {
      // Don't fade the thumbnail yet — wait until the video has a frame ready
      if (!this.previewLoaded) {
        // First time — inject <source>, let Angular render it, then play
        this.previewLoaded = true;
        setTimeout(() => this.playPreview(thumbWrap), 50);
      } else {
        this.playPreview(thumbWrap);
      }
    }, 2000);
  }

  onThumbLeave(event: MouseEvent): void {
    // Cancel the pending delay if the user left before 2 s
    clearTimeout(this.previewDelayTimer);
    this.previewDelayTimer = null;
    this.isPreviewPlaying = false;        // thumbnail cover fades back in

    const thumbWrap = event.currentTarget as HTMLElement;
    const video = thumbWrap.querySelector<HTMLVideoElement>('video.video-preview');
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    this.mediaManager.cardHoverEnd();     // allow the hero carousel to resume
  }

  private playPreview(thumbWrap: HTMLElement): void {
    const video = thumbWrap.querySelector<HTMLVideoElement>('video.video-preview');
    if (!video) return;

    // Fade the thumbnail only once the video has a decoded frame ready.
    // This prevents the black flash between thumbnail fade-out and first frame.
    const onCanPlay = () => {
      this.isPreviewPlaying = true;
      video.removeEventListener('canplay', onCanPlay);
    };
    video.addEventListener('canplay', onCanPlay);

    video.play().catch(() => {
      // Autoplay blocked or src error — keep thumbnail visible
      video.removeEventListener('canplay', onCanPlay);
    });
  }

  deleteVideo() {
    if (!this.currentUserId || !this.video._id) return;
    this.videoDeleted.emit(this.video._id);
  }

  onAvatarError(event: Event): void {
    // Hide broken image and fall through to the ng-template initialsAvatar
    (event.target as HTMLImageElement).style.display = 'none';
  }

  formatViews(count: number): string {
    if (!count) return '0';
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return count.toLocaleString();
  }
}