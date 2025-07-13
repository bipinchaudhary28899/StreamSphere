import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VideoService } from '../../services/video.service';
import { Video } from '../../models/video';

@Component({
  selector: 'app-hero-carousel',
  templateUrl: './hero-carousel.component.html',
  styleUrls: ['./hero-carousel.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class HeroCarouselComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef<HTMLVideoElement>;
  
  videos: Video[] = [];
  currentIndex = 0;
  isLoading = true;
  error = '';
  private intersectionObserver: IntersectionObserver | null = null;
  private autoAdvanceTimer: any = null;
  private readonly AUTO_ADVANCE_INTERVAL = 8000; // 8 seconds

  constructor(private videoService: VideoService) {}

  ngOnInit(): void {
    this.loadTopVideos();
    
    // Set up intersection observer
    this.setupIntersectionObserver();
    
    // Add visibility change listener to pause video when window loses focus
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    
    // Debug: Check video element after a delay
    setTimeout(() => {
      this.checkVideoElement();
    }, 2000);
  }

  private checkVideoElement(): void {
    console.log('Checking video element...');
    console.log('Video element exists:', !!this.videoElement);
    console.log('Video element native element:', this.videoElement?.nativeElement);
    console.log('Current video:', this.currentVideo);
    console.log('Videos array length:', this.videos.length);
  }

  ngOnDestroy(): void {
    // Clean up intersection observer
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    
    // Clean up auto-advance timer
    this.stopAutoAdvance();
    
    // Clean up visibility change listener
    document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
  }

  private handleVisibilityChange(): void {
    if (document.hidden) {
      // Pause video and auto-advance when page becomes hidden
      if (this.videoElement?.nativeElement) {
        this.videoElement.nativeElement.pause();
        console.log('Video paused due to page visibility change');
      }
      this.stopAutoAdvance();
    } else {
      // Resume video and auto-advance when page becomes visible again
      if (this.videoElement?.nativeElement) {
        console.log('Page became visible, attempting to resume video...');
        this.videoElement.nativeElement.play().then(() => {
          console.log('Video resumed successfully after visibility change');
          this.startAutoAdvance();
        }).catch(error => {
          console.log('Failed to resume video after visibility change:', error);
          this.startAutoAdvance();
        });
      } else {
        this.startAutoAdvance();
      }
    }
  }

  private startAutoAdvance(): void {
    this.stopAutoAdvance(); // Clear any existing timer
    this.autoAdvanceTimer = setInterval(() => {
      console.log('Auto-advancing to next video...');
      this.nextVideo();
    }, this.AUTO_ADVANCE_INTERVAL);
    console.log('Auto-advance timer started');
  }

  private stopAutoAdvance(): void {
    if (this.autoAdvanceTimer) {
      clearInterval(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
      console.log('Auto-advance timer stopped');
    }
  }

  private setupIntersectionObserver(): void {
    console.log('Setting up intersection observer...');
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const video = entry.target as HTMLVideoElement;
          console.log('Video intersection:', entry.isIntersecting, video);
          if (entry.isIntersecting) {
            // Video is visible, play it and start auto-advance
            console.log('Attempting to play video...');
            video.play().then(() => {
              console.log('Video started playing successfully');
              this.startAutoAdvance();
            }).catch(error => {
              console.log('Auto-play failed:', error);
              // Try again after a delay
              setTimeout(() => {
                video.play().then(() => {
                  console.log('Video started playing on retry');
                  this.startAutoAdvance();
                }).catch(retryError => {
                  console.log('Retry play also failed:', retryError);
                  this.startAutoAdvance(); // Start auto-advance even if video doesn't play
                });
              }, 1000);
            });
          } else {
            // Video is not visible, pause it and stop auto-advance
            console.log('Pausing video...');
            video.pause();
            this.stopAutoAdvance();
          }
        });
      },
      {
        threshold: 0.3, // Lower threshold to trigger earlier
        rootMargin: '0px'
      }
    );
    console.log('Intersection observer created');
  }

  loadTopVideos(): void {
    this.isLoading = true;
    this.error = '';
    console.log('Loading top videos...');

    this.videoService.getTopLikedVideos().subscribe({
      next: (backendVideos) => {
        console.log('Backend videos received:', backendVideos);
        
        // Map backend data to frontend Video interface
        this.videos = backendVideos.map((backendVideo: any) => ({
          _id: backendVideo._id,
          title: backendVideo.title,
          description: backendVideo.description || 'Watch this amazing video on StreamSphere',
          S3_url: backendVideo.S3_url,
          thumbnail_url: this.generateThumbnailUrl(backendVideo.S3_url, backendVideo.category),
          user_id: backendVideo.user_id || '',
          category: backendVideo.category,
          likes: backendVideo.likes || 0,
          dislikes: backendVideo.dislikes || 0,
          uploadedAt: backendVideo.uploadedAt,
          commentCount: backendVideo.commentCount || 0
        }));
        
        console.log('Mapped videos:', this.videos);
        this.isLoading = false;
        
        // Set up intersection observer for the current video after data loads
        setTimeout(() => {
          this.observeCurrentVideo();
          // Force play if visible after data loads
          setTimeout(() => {
            this.forcePlayIfVisible();
          }, 300);
        }, 100);
      },
      error: (error) => {
        console.error('Error loading top videos:', error);
        this.error = 'Failed to load videos';
        this.isLoading = false;
      }
    });
  }

  private generateThumbnailUrl(videoUrl: string, category?: string): string {
    // Create category-based placeholder thumbnails
    const baseUrl = 'https://via.placeholder.com/1280x720';
    const colors = {
      'Sports': 'FF6B35/FFFFFF',
      'Music': '9B59B6/FFFFFF', 
      'Gaming': 'E74C3C/FFFFFF',
      'Education': '3498DB/FFFFFF',
      'Technology': '2C3E50/FFFFFF',
      'Fashion': 'E91E63/FFFFFF',
      'Art & Design': 'F39C12/FFFFFF',
      'Food': '27AE60/FFFFFF',
      'Travel': '1ABC9C/FFFFFF',
      'Comedy': 'FFD700/000000',
      'News': '34495E/FFFFFF',
      'Lifestyle': 'E67E22/FFFFFF'
    };
    
    const colorPair = colors[category as keyof typeof colors] || '000000/FFFFFF';
    const text = encodeURIComponent(category || 'Video');
    return `${baseUrl}/${colorPair}?text=${text}`;
  }

  formatViews(views: number): string {
    if (views >= 1000000) {
      return (views / 1000000).toFixed(1) + 'M';
    } else if (views >= 1000) {
      return (views / 1000).toFixed(1) + 'K';
    }
    return views.toString();
  }

  formatTimestamp(date: Date): string {
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
    console.log('Observing current video...');
    if (this.videoElement && this.intersectionObserver) {
      this.intersectionObserver.observe(this.videoElement.nativeElement);
      console.log('Current video observed.');
    } else {
      console.warn('Video element or intersection observer not ready for observation.');
    }
  }

  private unobserveCurrentVideo(): void {
    if (this.videoElement && this.intersectionObserver) {
      this.intersectionObserver.unobserve(this.videoElement.nativeElement);
      console.log('Current video un-observed.');
    }
  }

  nextVideo(): void {
    this.unobserveCurrentVideo();
    this.stopAutoAdvance(); // Stop current timer
    this.currentIndex = (this.currentIndex + 1) % this.videos.length;
    setTimeout(() => {
      this.observeCurrentVideo();
      // Check if new video should be playing
      setTimeout(() => {
        this.forcePlayIfVisible();
      }, 200);
    }, 100);
  }

  previousVideo(): void {
    this.unobserveCurrentVideo();
    this.stopAutoAdvance(); // Stop current timer
    this.currentIndex = (this.currentIndex - 1 + this.videos.length) % this.videos.length;
    setTimeout(() => {
      this.observeCurrentVideo();
      // Check if new video should be playing
      setTimeout(() => {
        this.forcePlayIfVisible();
      }, 200);
    }, 100);
  }

  onVideoLoad(): void {
    console.log('Video loaded, observing for visibility...');
    
    // Video loaded, observe it for visibility
    this.observeCurrentVideo();
    
    // Try to play immediately if visible and page is active
    setTimeout(() => {
      this.forcePlayIfVisible();
    }, 200);
  }

  private forcePlayIfVisible(): void {
    if (this.videoElement?.nativeElement && !document.hidden) {
      const video = this.videoElement.nativeElement;
      const rect = video.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
      
      console.log('Force checking video visibility:', isVisible, 'document.hidden:', document.hidden);
      
      if (isVisible && !document.hidden) {
        console.log('Video is visible on page load, forcing play...');
        video.play().then(() => {
          console.log('Video started playing on page load');
          this.startAutoAdvance();
        }).catch(error => {
          console.log('Force play failed:', error);
          // Try again after a short delay
          setTimeout(() => {
            video.play().then(() => {
              console.log('Video started playing on retry');
              this.startAutoAdvance();
            }).catch(retryError => {
              console.log('Retry play also failed:', retryError);
              this.startAutoAdvance(); // Start auto-advance even if video doesn't play
            });
          }, 500);
        });
      }
    }
  }

  onPlayNowClick(): void {
    if (this.videos[this.currentIndex]) {
      // Navigate to video player page
      window.location.href = `/video/${this.videos[this.currentIndex]._id}`;
    }
  }

  get currentVideo(): Video | null {
    return this.videos[this.currentIndex] || null;
  }

  get progressPercentage(): number {
    return ((this.currentIndex + 1) / this.videos.length) * 100;
  }
} 