import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
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
  @ViewChild('videoElement', { static: false }) videoRef!: ElementRef<HTMLVideoElement>;

  video: any = null;
  loading: boolean = true;
  error: string | null = null;
  isOwner: boolean = false;
  isDeleteHovered: boolean = false;
  descOpen: boolean = false;
  currentUserId: string | null = null;
  userReaction: 'liked' | 'disliked' | 'none' = 'none';
  isLiking: boolean = false;
  isDisliking: boolean = false;

  // ── HLS quality switcher state ────────────────────────────────────────────
  private hls: Hls | null = null;
  hlsLevels: Array<{ name: string; index: number }> = [];
  hlsCurrentLevel: number = -1;   // -1 = auto
  showQualityMenu: boolean = false;

  constructor(
    private route: ActivatedRoute,
    private videoService: VideoService,
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

  ngOnDestroy(): void {
    this.destroyHls();
  }

  loadVideo(videoId: string) {
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
          // Defer HLS init until the <video> element is in the DOM
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

  // ── HLS player initialisation ─────────────────────────────────────────────

  private initHlsPlayer(): void {
    const videoEl = this.videoRef?.nativeElement;
    if (!videoEl || !this.video?.hlsUrl) return;

    this.destroyHls();

    if (Hls.isSupported()) {
      this.hls = new Hls({
        // Start with the highest quality and let ABR take over from there.
        startLevel: -1,
        capLevelToPlayerSize: true,
      });

      this.hls.loadSource(this.video.hlsUrl);
      this.hls.attachMedia(videoEl);

      this.hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
        // Build quality level list from the parsed manifest
        this.hlsLevels = [
          { name: 'Auto', index: -1 },
          ...data.levels.map((lvl: any, i: number) => ({
            name: lvl.height ? `${lvl.height}p` : `Level ${i}`,
            index: i,
          })),
        ];
        this.hlsCurrentLevel = -1;  // Auto
      });

      this.hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        // Keep UI in sync when ABR switches levels automatically
        if (this.hlsCurrentLevel === -1) return;
        this.hlsCurrentLevel = data.level;
      });

    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari: native HLS support — just set the src
      videoEl.src = this.video.hlsUrl;
    }
  }

  setQuality(levelIndex: number): void {
    if (!this.hls) return;
    this.hlsCurrentLevel = levelIndex;
    this.hls.currentLevel = levelIndex;   // -1 = ABR auto
    this.showQualityMenu = false;
  }

  get currentQualityLabel(): string {
    if (this.hlsCurrentLevel === -1) return 'Auto';
    const lvl = this.hlsLevels.find(l => l.index === this.hlsCurrentLevel);
    return lvl ? lvl.name : 'Auto';
  }

  private destroyHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  // ── Auth / view helpers ───────────────────────────────────────────────────

  private recordWatchHistory(videoId: string) {
    const userData = localStorage.getItem('user');
    if (!userData) return;

    const user = JSON.parse(userData);
    if (!user?.userId) return;

    this.videoService.addToHistory(videoId, user.userId).subscribe({
      error: (err) => console.error('Failed to record watch history:', err),
    });
  }

  private doRecordView(videoId: string) {
    this.videoService.recordView(videoId).subscribe({
      next: (res) => { if (res.views > 0) this.video.views = res.views; },
      error: () => {}
    });
  }

  checkUserAuthentication() {
    const userData = localStorage.getItem('user');

    if (userData) {
      try {
        const user = JSON.parse(userData);
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
    if (!this.currentUserId || !this.video._id || this.isLiking) return;

    this.isLiking = true;

    this.videoService.likeVideo(this.video._id).subscribe({
      next: (updatedVideo) => {
        this.video.likes = updatedVideo.likes;
        this.video.dislikes = updatedVideo.dislikes;

        if (this.userReaction === 'liked') {
          this.userReaction = 'none';
        } else {
          this.userReaction = 'liked';
        }
        this.isLiking = false;
      },
      error: (err) => {
        console.error('Error liking video:', err);
        this.isLiking = false;
        alert('Failed to like video. Please try again.');
      },
    });
  }

  onDislikeClick() {
    if (!this.currentUserId || !this.video._id || this.isDisliking) return;

    this.isDisliking = true;

    this.videoService.dislikeVideo(this.video._id).subscribe({
      next: (updatedVideo) => {
        this.video.likes = updatedVideo.likes;
        this.video.dislikes = updatedVideo.dislikes;

        if (this.userReaction === 'disliked') {
          this.userReaction = 'none';
        } else {
          this.userReaction = 'disliked';
        }
        this.isDisliking = false;
      },
      error: (err) => {
        console.error('Error disliking video:', err);
        this.isDisliking = false;
        alert('Failed to dislike video. Please try again.');
      },
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
