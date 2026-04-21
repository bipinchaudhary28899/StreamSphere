import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { VideoService } from '../../services/video.service';
import { CommentSectionComponent } from '../comment-section/comment-section.component';

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
export class VideoPlayerComponent implements OnInit {
  video: any = null;
  safeVideoUrl: SafeResourceUrl | null = null;
  loading: boolean = true;
  error: string | null = null;
  isOwner: boolean = false;
  isDeleteHovered: boolean = false;
  descOpen: boolean = false;
  currentUserId: string | null = null;
  userReaction: 'liked' | 'disliked' | 'none' = 'none';
  isLiking: boolean = false;
  isDisliking: boolean = false;

  constructor(
    private route: ActivatedRoute,
    private videoService: VideoService,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit() {
    const videoId = this.route.snapshot.paramMap.get('id');
    if (videoId) {
      this.loadVideo(videoId);
    } else {
      this.error = 'Video ID not found';
      this.loading = false;
    }
  }

  loadVideo(videoId: string) {
    this.loading = true;
    this.error = null;

    this.videoService.getVideoById(videoId).subscribe({
      next: (video: any) => {
        this.video = video;
        if (this.video) {
          this.safeVideoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
            this.video.S3_url,
          );
          this.checkUserAuthentication();
          this.loading = false;
          this.recordWatchHistory(videoId);
          this.doRecordView(videoId);
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

  private recordWatchHistory(videoId: string) {
    const userData = localStorage.getItem('user');
    if (!userData) return;

    const user = JSON.parse(userData);
    if (!user?.userId) return;

    this.videoService.addToHistory(videoId, user.userId).subscribe({
      error: (err) => console.error('Failed to record watch history:', err),
    });
  }

  // Called for ALL visitors (logged-in or anonymous) — auth token is included
  // automatically by videoService so the backend builds a per-user dedup key.
  private doRecordView(videoId: string) {
    this.videoService.recordView(videoId).subscribe({
      next: (res) => { if (res.views > 0) this.video.views = res.views; },
      error: () => {} // silently ignore — view count is non-critical
    });
  }

  checkUserAuthentication() {
    const userData = localStorage.getItem('user');

    if (userData) {
      try {
        const user = JSON.parse(userData);
        // Use optional chaining — backend may return userId or _id depending on shape
        this.currentUserId = user.userId || user._id || null;
        this.isOwner = this.video.user_id === this.currentUserId;

        if (this.currentUserId) {
          this.getUserReaction();
        }
      } catch (error) {
        console.error('Error parsing user data:', error);
        this.currentUserId = null;
        this.isOwner = false;
      }
    } else {
      this.currentUserId = null;
      this.isOwner = false;
    }
  }

  getUserReaction() {
    if (!this.currentUserId || !this.video._id) return;

    this.videoService.getUserReaction(this.video._id).subscribe({
      next: (response) => {
        this.userReaction = response.reaction as 'liked' | 'disliked' | 'none';
      },
      error: (err) => {
        console.error('Error getting user reaction:', err);
        this.userReaction = 'none';
      },
    });
  }

  onLikeClick() {
    if (!this.currentUserId || !this.video._id || this.isLiking) {
      return;
    }

    this.isLiking = true;

    this.videoService.likeVideo(this.video._id).subscribe({
      next: (updatedVideo) => {
        // Update the video data with new like count
        this.video.likes = updatedVideo.likes;
        this.video.dislikes = updatedVideo.dislikes;

        // Update user reaction
        if (this.userReaction === 'liked') {
          this.userReaction = 'none';
        } else {
          // Remove dislike if user had disliked
          if (this.userReaction === 'disliked') {
            this.userReaction = 'none';
          }
          this.userReaction = 'liked';
        }
        this.isLiking = false;
      },
      error: (err) => {
        console.error('Error liking video:', err);
        console.error('Error details:', err.error);
        this.isLiking = false;
        alert('Failed to like video. Please try again.');
      },
    });
  }

  onDislikeClick() {
    if (!this.currentUserId || !this.video._id || this.isDisliking) {
      return;
    }

    this.isDisliking = true;

    this.videoService.dislikeVideo(this.video._id).subscribe({
      next: (updatedVideo) => {
        // Update the video data with new dislike count
        this.video.likes = updatedVideo.likes;
        this.video.dislikes = updatedVideo.dislikes;

        // Update user reaction
        if (this.userReaction === 'disliked') {
          this.userReaction = 'none';
        } else {
          // Remove like if user had liked
          if (this.userReaction === 'liked') {
            this.userReaction = 'none';
          }
          this.userReaction = 'disliked';
        }
        this.isDisliking = false;
      },
      error: (err) => {
        console.error('Error disliking video:', err);
        console.error('Error details:', err.error);
        this.isDisliking = false;
        alert('Failed to dislike video. Please try again.');
      },
    });
  }

  onDeleteClick() {
    if (!this.video || !this.isOwner) return;
    if (
      confirm(
        'Are you sure you want to delete this video? This action cannot be undone.',
      )
    ) {
      const userData = localStorage.getItem('user');
      if (!userData) return;
      const user = JSON.parse(userData);
      this.videoService.deleteVideo(this.video._id, user.userId).subscribe({
        next: () => {
          alert('Video deleted successfully.');
          window.location.href = '/home';
        },
        error: (err) => {
          console.error('Error deleting video:', err);
          alert('Failed to delete video. Please try again.');
        },
      });
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  retryLoad() {
    const videoId = this.route.snapshot.paramMap.get('id');
    if (videoId) {
      this.loadVideo(videoId);
    }
  }

  formatViews(count: number): string {
    if (!count) return '0';
    if (count >= 1_000_000) return (count / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (count >= 1_000) return (count / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    return count.toLocaleString();
  }
}
