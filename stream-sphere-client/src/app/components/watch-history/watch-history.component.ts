import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { VideoService } from '../../services/video.service';
import { VideoCardComponent } from '../video-card/video-card.component';
import { MatIconModule } from '@angular/material/icon';

export interface HistoryGroup {
  label: string;
  videos: any[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-watch-history',
  standalone: true,
  imports: [CommonModule, RouterLink, VideoCardComponent, MatIconModule],
  templateUrl: './watch-history.component.html',
  styleUrl: './watch-history.component.css'
})
export class WatchHistoryComponent implements OnInit {
  @Input() showHeader: boolean = true;

  groups: HistoryGroup[] = [];
  total = 0;
  loading = true;
  failed = false;
  signedOut = false;
  readonly skeletons = Array.from({ length: 8 });

  constructor(private videoService: VideoService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    if (!localStorage.getItem('user')) {
      this.signedOut = true;
      this.loading = false;
      return;
    }

    this.loading = true;
    this.failed = false;
    this.videoService.getWatchHistory().subscribe({
      next: (entries) => {
        // Each entry has video_id populated with the full video (null if it was deleted)
        const watched = (entries || []).filter((entry: any) => entry?.video_id);
        this.groups = this.groupByDay(watched);
        this.total = watched.length;
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load watch history:', err);
        this.failed = true;
        this.loading = false;
      }
    });
  }

  /** Buckets entries (already newest first) into Today / Yesterday / … groups. */
  private groupByDay(entries: any[]): HistoryGroup[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfToday = today.getTime();

    const buckets: { label: string; from: number }[] = [
      { label: 'Today', from: startOfToday },
      { label: 'Yesterday', from: startOfToday - DAY_MS },
      { label: 'Previous 7 days', from: startOfToday - 7 * DAY_MS },
      { label: 'Previous 30 days', from: startOfToday - 30 * DAY_MS },
      { label: 'Older', from: -Infinity },
    ];

    const groups = new Map<string, any[]>();
    for (const entry of entries) {
      const watchedAt = new Date(entry.watchedAt).getTime();
      const time = Number.isNaN(watchedAt) ? -Infinity : watchedAt;
      const bucket = buckets.find(b => time >= b.from)!;
      if (!groups.has(bucket.label)) groups.set(bucket.label, []);
      groups.get(bucket.label)!.push(entry.video_id);
    }

    return buckets
      .filter(b => groups.has(b.label))
      .map(b => ({ label: b.label, videos: groups.get(b.label)! }));
  }

  trackByLabel(_: number, group: HistoryGroup) {
    return group.label;
  }

  trackById(index: number, video: any) {
    return video?._id ?? index;
  }
}
