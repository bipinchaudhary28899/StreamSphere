import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { VideoService } from '../../services/video.service';

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent implements OnInit {
  video: any = null;
  safeVideoUrl: SafeResourceUrl | null = null;
  loading: boolean = true;
  error: string | null = null;

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