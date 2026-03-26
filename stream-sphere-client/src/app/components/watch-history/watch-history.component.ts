import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VideoService } from '../../services/video.service';
import { VideoCardComponent } from '../video-card/video-card.component';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-watch-history',
  standalone: true,
  imports: [CommonModule, VideoCardComponent, MatIconModule],
  templateUrl: './watch-history.component.html',
  styleUrl: './watch-history.component.css'
})
export class WatchHistoryComponent implements OnInit {
  history: any[] = [];
  loading = true;
  error: string | null = null;
  @Input() showHeader: boolean = true;
  constructor(private videoService: VideoService) {}

  ngOnInit() {
    const userData = localStorage.getItem('user');
    if (!userData) {
      this.error = 'Please log in to view your watch history.';
      this.loading = false;
      return;
    }

    this.videoService.getWatchHistory().subscribe({
      next: (data) => {
        // each entry has video_id populated with full video object
        this.history = data.map((entry: any) => entry.video_id).filter(Boolean);
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load watch history:', err);
        this.error = 'Failed to load watch history.';
        this.loading = false;
      }
    });
  }
}