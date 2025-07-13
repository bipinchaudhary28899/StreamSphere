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
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule, CommentSectionComponent],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent implements OnInit {
  video: any = null;
  safeVideoUrl: SafeResourceUrl | null = null;
  loading: boolean = true;
  error: string | null = null;
  isOwner: boolean = false;
  isDeleteHovered: boolean = false;
  currentUserId: string | null = null;
  userReaction: 'liked' | 'disliked' | 'none' = 'none';
  isLiking: boolean = false;
  isDisliking: boolean = false;

  constructor(
    private route: ActivatedRoute,
    private videoService: VideoService,
    private sanitizer: DomSanitizer
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
    
    // For now, we'll fetch all videos and find the one with matching ID
    // In a real app, you'd have a specific endpoint to fetch video by ID
    this.videoService.getAllVideos().subscribe({
      next: (videos: any[]) => {
        this.video = videos.find(v => v._id === videoId);
        if (this.video) {
          this.safeVideoUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.video.S3_url);
          // Check if current user is the owner
          this.checkUserAuthentication();
          this.loading = false;
        } else {
          this.error = 'Video not found';
          this.loading = false;
        }
      },
      error: (err: any) => {
        console.error('Error loading video:', err);
        this.error = 'Error loading video';
        this.loading = false;
      }
    });
  }

  checkUserAuthentication() {
    const userData = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    
    console.log('Checking user authentication:');
    console.log('User data:', userData);
    console.log('Token exists:', !!token);
    console.log('Token value:', token ? token.substring(0, 20) + '...' : 'null');
    
    if (userData && token) {
      try {
        const user = JSON.parse(userData);
        this.currentUserId = user.userId;
        this.isOwner = this.video.user_id === user.userId;
        console.log('User authenticated:', this.currentUserId);
        console.log('Is owner:', this.isOwner);
        // Get user's reaction to this video
        this.getUserReaction();
      } catch (error) {
        console.error('Error parsing user data:', error);
        this.currentUserId = null;
        this.isOwner = false;
      }
    } else {
      console.log('User not authenticated - missing data or token');
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
      }
    });
  }

  onLikeClick() {
    if (!this.currentUserId || !this.video._id || this.isLiking) {
      console.log('Cannot like: userId=', this.currentUserId, 'videoId=', this.video._id, 'isLiking=', this.isLiking);
      return;
    }
    
    this.isLiking = true;
    console.log('Attempting to like video:', this.video._id);
    console.log('Current user ID:', this.currentUserId);
    console.log('Token exists:', !!localStorage.getItem('token'));
    
    this.videoService.likeVideo(this.video._id).subscribe({
      next: (updatedVideo) => {
        console.log('Like successful:', updatedVideo);
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
      }
    });
  }

  onDislikeClick() {
    if (!this.currentUserId || !this.video._id || this.isDisliking) {
      console.log('Cannot dislike: userId=', this.currentUserId, 'videoId=', this.video._id, 'isDisliking=', this.isDisliking);
      return;
    }
    
    this.isDisliking = true;
    console.log('Attempting to dislike video:', this.video._id);
    console.log('Current user ID:', this.currentUserId);
    console.log('Token exists:', !!localStorage.getItem('token'));
    
    this.videoService.dislikeVideo(this.video._id).subscribe({
      next: (updatedVideo) => {
        console.log('Dislike successful:', updatedVideo);
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
      }
    });
  }

  onDeleteClick() {
    if (!this.video || !this.isOwner) return;
    if (confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
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
        }
      });
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  retryLoad() {
    const videoId = this.route.snapshot.paramMap.get('id');
    if (videoId) {
      this.loadVideo(videoId);
    }
  }
}