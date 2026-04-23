import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { VideoService } from '../../services/video.service';
import { Video } from '../../models/video';
import { MediaManagerService } from '../../services/media-manager.service';

@Component({
  selector: 'app-hero-carousel',
  templateUrl: './hero-carousel.component.html',
  styleUrls: ['./hero-carousel.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class HeroCarouselComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef<HTMLVideoElement>;

  videos: Video[] = [];
  currentIndex = 0;
  isLoading = true;
  error = '';
  isMuted = true;
  hasAudio = true;   // default true; checkAudioTrack() may override if API available
  userInteracted = false;
  descriptionExpanded = false;

  /** Min chars before "Read more" is shown — short descriptions need no toggle */
  readonly DESC_THRESHOLD = 120;

  private viewInitialized = false;
  private dataLoaded = false;
  private intersectionObserver: IntersectionObserver | null = null;
  private autoAdvanceTimer: any = null;
  private readonly AUTO_ADVANCE_INTERVAL = 8000;
  private visibilityChangeHandler = this.handleVisibilityChange.bind(this);
  private mediaSubs = new Subscription();

  constructor(
    private videoService: VideoService,
    private ngZone: NgZone,
    private mediaManager: MediaManagerService,
  ) {}

  ngOnInit(): void {
    this.loadTopVideos();
    this.setupIntersectionObserver();
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    this.subscribeToMediaManager();
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    if (this.dataLoaded) {
      this.initPlayback();
    }
  }

  ngOnDestroy(): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    this.stopAutoAdvance();
    this.mediaSubs.unsubscribe();
    document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
  }

  // Arrow function — correct 'this' without bind(), public for template access
  handleWatchWithSound = (): void => {
    this.userInteracted = true;
    this.isMuted = false;
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.muted = false;
    }
  }

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.muted = this.isMuted;
    }
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      if (this.videoElement?.nativeElement) {
        this.videoElement.nativeElement.pause();
      }
      this.stopAutoAdvance();
    } else {
      if (this.videoElement?.nativeElement) {
        this.videoElement.nativeElement.play()
          .then(() => this.startAutoAdvance())
          .catch(() => this.startAutoAdvance());
      } else {
        this.startAutoAdvance();
      }
    }
  }

  private subscribeToMediaManager(): void {
    // A card preview started — pause the carousel and its auto-advance timer
    this.mediaSubs.add(
      this.mediaManager.pauseCarousel$.subscribe(() => {
        this.stopAutoAdvance();
        this.videoElement?.nativeElement?.pause();
      })
    );

    // Last card hover ended — resume carousel from where it left off
    this.mediaSubs.add(
      this.mediaManager.resumeCarousel$.subscribe(() => {
        this.forcePlayIfVisible();
      })
    );
  }

  private startAutoAdvance(): void {
    this.stopAutoAdvance();
    this.autoAdvanceTimer = setInterval(() => {
      this.nextVideo();
    }, this.AUTO_ADVANCE_INTERVAL);
  }

  private stopAutoAdvance(): void {
    if (this.autoAdvanceTimer) {
      clearInterval(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
  }

  private setupIntersectionObserver(): void {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const video = entry.target as HTMLVideoElement;
          if (entry.isIntersecting) {
            video.play()
              .then(() => this.startAutoAdvance())
              .catch(() => {
                setTimeout(() => {
                  video.play()
                    .then(() => this.startAutoAdvance())
                    .catch(() => this.startAutoAdvance());
                }, 1000);
              });
          } else {
            video.pause();
            this.stopAutoAdvance();
          }
        });
      },
      { threshold: 0.3, rootMargin: '0px' }
    );
  }

  loadTopVideos(): void {
    this.isLoading = true;
    this.error = '';

    this.videoService.getTopLikedVideos().subscribe({
      next: (backendVideos) => {
        this.videos = backendVideos.map((backendVideo: any) => ({
          _id: backendVideo._id,
          title: backendVideo.title,
          description: backendVideo.description || 'Watch this amazing video on StreamSphere',
          S3_url: backendVideo.S3_url,
          hlsUrl: backendVideo.hlsUrl || null,
          previewUrl: backendVideo.previewUrl || null,
          thumbnailUrl: backendVideo.thumbnailUrl || null,
          user_id: backendVideo.user_id || '',
          category: backendVideo.category,
          likes: backendVideo.likes || 0,
          dislikes: backendVideo.dislikes || 0,
          uploadedAt: backendVideo.uploadedAt || '',
          commentCount: backendVideo.commentCount || 0
        }));

        this.isLoading = false;
        this.dataLoaded = true;

        if (this.viewInitialized) {
          this.initPlayback();
        }
      },
      error: (error) => {
        console.error('Error loading top videos:', error);
        this.error = 'Failed to load videos';
        this.isLoading = false;
      }
    });
  }

  private initPlayback(): void {
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.ngZone.run(() => {
            this.observeCurrentVideo();
            this.forcePlayIfVisible();
          });
        });
      });
    });
  }

  formatTimestamp(date: Date): string {
    if (!date || isNaN(date.getTime())) return 'Unknown date';
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return Math.floor(diffInSeconds / 60) + ' minutes ago';
    if (diffInSeconds < 86400) return Math.floor(diffInSeconds / 3600) + ' hours ago';
    if (diffInSeconds < 2592000) return Math.floor(diffInSeconds / 86400) + ' days ago';
    return Math.floor(diffInSeconds / 2592000) + ' months ago';
  }

  createDate(dateString: string): Date {
    return new Date(dateString);
  }

  private observeCurrentVideo(): void {
    if (this.videoElement && this.intersectionObserver) {
      this.intersectionObserver.observe(this.videoElement.nativeElement);
    }
  }

  private unobserveCurrentVideo(): void {
    if (this.videoElement && this.intersectionObserver) {
      this.intersectionObserver.unobserve(this.videoElement.nativeElement);
    }
  }

  private checkAudioTrack(): void {
    if (!this.videoElement?.nativeElement) {
      this.hasAudio = false;
      return;
    }
    const video = this.videoElement.nativeElement;
    if ((video as any).audioTracks) {
      this.hasAudio = (video as any).audioTracks.length > 0;
    } else {
      // Can't detect — default to true so button always shows as fallback
      this.hasAudio = true;
    }
  }

  onVideoLoad(): void {
    this.checkAudioTrack();
    this.observeCurrentVideo();
    // Always start muted — required by browser for autoplay without interaction
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.muted = true;
    }
    setTimeout(() => this.forcePlayIfVisible(), 200);
  }

  private forcePlayIfVisible(): void {
    if (this.videoElement?.nativeElement && !document.hidden) {
      const video = this.videoElement.nativeElement;
      const rect = video.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0;

      if (isVisible) {
        // Always muted before interaction — browser hard requirement
        video.muted = !this.userInteracted ? true : this.isMuted;
        video.play()
          .then(() => this.startAutoAdvance())
          .catch(() => {
            setTimeout(() => {
              video.play()
                .then(() => this.startAutoAdvance())
                .catch(() => this.startAutoAdvance());
            }, 500);
          });
      }
    }
  }

  toggleDescription(event: Event): void {
    event.stopPropagation();
    this.descriptionExpanded = !this.descriptionExpanded;
  }

  nextVideo(): void {
    this.unobserveCurrentVideo();
    this.stopAutoAdvance();
    this.descriptionExpanded = false;
    this.currentIndex = (this.currentIndex + 1) % this.videos.length;
    setTimeout(() => {
      this.observeCurrentVideo();
      setTimeout(() => {
        if (this.videoElement?.nativeElement) {
          this.videoElement.nativeElement.muted = !this.userInteracted ? true : this.isMuted;
        }
        this.forcePlayIfVisible();
        this.startAutoAdvance();
      }, 200);
    }, 100);
  }

  previousVideo(): void {
    this.unobserveCurrentVideo();
    this.stopAutoAdvance();
    this.descriptionExpanded = false;
    this.currentIndex = (this.currentIndex - 1 + this.videos.length) % this.videos.length;
    setTimeout(() => {
      this.observeCurrentVideo();
      setTimeout(() => {
        if (this.videoElement?.nativeElement) {
          this.videoElement.nativeElement.muted = !this.userInteracted ? true : this.isMuted;
        }
        this.forcePlayIfVisible();
        this.startAutoAdvance();
      }, 200);
    }, 100);
  }

  onPlayNowClick(): void {
    if (this.videos[this.currentIndex]) {
      window.location.href = `/video/${this.videos[this.currentIndex]._id}`;
    }
  }

  get currentVideo(): Video | null {
    return this.videos[this.currentIndex] || null;
  }

  /** The URL to play in the carousel — preview MP4 if available, raw MP4 as fallback */
  get currentPreviewSrc(): string {
    const v = this.currentVideo;
    if (!v) return '';
    return v.previewUrl || v.S3_url;
  }

  get progressPercentage(): number {
    return ((this.currentIndex + 1) / this.videos.length) * 100;
  }
}
