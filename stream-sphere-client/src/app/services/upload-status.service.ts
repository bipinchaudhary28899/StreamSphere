// services/upload-status.service.ts
//
// Tracks videos that are currently being HLS-transcoded.
// After a successful upload, the upload component registers the video here.
// The home feed subscribes and shows a banner + polls until status = 'ready'.

import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import { VideoService } from './video.service';

export interface ProcessingVideo {
  id: string;
  title: string;
}

@Injectable({ providedIn: 'root' })
export class UploadStatusService implements OnDestroy {

  private _processing$ = new BehaviorSubject<ProcessingVideo[]>([]);
  readonly processing$ = this._processing$.asObservable();

  // Emits the videoId when a video flips to 'ready'
  private _ready$ = new BehaviorSubject<string | null>(null);
  readonly ready$ = this._ready$.asObservable();

  private pollSub: Subscription | null = null;

  constructor(private videoService: VideoService) {}

  /** Call this right after save-video succeeds */
  track(id: string, title: string): void {
    const current = this._processing$.value;
    if (current.find(v => v.id === id)) return; // already tracked
    this._processing$.next([...current, { id, title }]);
    this.startPolling();
  }

  private startPolling(): void {
    if (this.pollSub) return; // already polling
    this.pollSub = interval(8000).subscribe(() => this.checkAll());
  }

  private checkAll(): void {
    const list = this._processing$.value;
    if (!list.length) {
      this.stopPolling();
      return;
    }

    list.forEach(v => {
      this.videoService.getVideoById(v.id).subscribe({
        next: (video: any) => {
          if (video?.status === 'ready') {
            this._ready$.next(v.id);
            this._processing$.next(
              this._processing$.value.filter(x => x.id !== v.id)
            );
          }
        },
        error: () => {} // silently ignore poll errors
      });
    });
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }
}
