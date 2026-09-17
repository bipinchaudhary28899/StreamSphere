import { Component, Inject, OnDestroy, OnInit, Renderer2 } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Subscription, filter } from 'rxjs';
import { UploadJob, UploadManagerService } from '../../services/upload-manager.service';
import { ProcessingVideo, UploadStatusService } from '../../services/upload-status.service';
import {
  buildStatusItems, statusDetail, statusIndeterminate, statusLabel, statusProgress,
  statusTitle, statusTone, statusWatchId, UploadStatusItem,
} from '../../shared/upload-status';

/** How long a "ready to watch" card stays before it tucks itself away */
const READY_VISIBLE_MS = 12000;

/** At most this many cards at once; the upload page lists everything. */
const MAX_CARDS = 3;

/**
 * Floating cards that follow uploads while the user browses other pages, each
 * with a link back to the upload page.
 *
 * They cover the uploads this tab is running and — for videos this tab didn't
 * upload, e.g. after a page refresh — anything the backend is still processing.
 */
@Component({
  selector: 'app-upload-indicator',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule],
  templateUrl: './upload-indicator.component.html',
  styleUrl: './upload-indicator.component.css',
})
export class UploadIndicatorComponent implements OnInit, OnDestroy {
  /** Cards on screen, newest upload first */
  items: UploadStatusItem[] = [];
  /** Polite screen-reader update, set when something changes phase */
  announcement = '';
  /** The upload page shows all of this itself */
  onUploadPage = false;

  private processing: ProcessingVideo[] = [];
  /** Videos that finished processing while this tab had no upload of its own */
  private readyVideos: ProcessingVideo[] = [];
  /** Cards the user closed, by key; cleared when that upload changes state */
  private dismissed = new Set<string>();
  private lastPhases = new Map<string, string>();
  private hideTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private subs = new Subscription();

  constructor(
    public uploads: UploadManagerService,
    private uploadStatus: UploadStatusService,
    private router: Router,
    private renderer: Renderer2,
    @Inject(DOCUMENT) private document: Document,
  ) {}

  ngOnInit(): void {
    this.readUrl(this.router.url);
    this.subs.add(
      this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe(e => {
          this.readUrl(e.urlAfterRedirects);
          this.rebuild();
        }),
    );

    this.subs.add(this.uploads.jobs$.subscribe(jobs => {
      const latest = jobs.length ? jobs[jobs.length - 1] : null;
      this.announcement = this.announce(latest);
      // A new state is news: show a card the user closed earlier again
      jobs.forEach(job => {
        if (this.lastPhases.get(job.id) !== job.phase) {
          this.lastPhases.set(job.id, job.phase);
          this.dismissed.delete(job.id);
        }
      });
      jobs.filter(job => job.phase === 'ready').forEach(job => this.autoHide(job.id));
      this.rebuild();
    }));

    // Videos still processing from before a refresh, so the cards are there
    // even when this tab isn't the one that uploaded them.
    this.uploadStatus.recover();
    this.subs.add(this.uploadStatus.processing$.subscribe(list => {
      this.processing = list;
      this.readyVideos = this.readyVideos.filter(v => !list.some(p => p.id === v.id));
      this.rebuild();
    }));
    this.subs.add(this.uploadStatus.ready$.subscribe(id => {
      if (!id) return;
      // An upload from this tab reports its own result
      if (this.uploads.jobs.some(job => job.videoId === id)) return;
      const video = this.processing.find(v => v.id === id);
      if (!video || this.readyVideos.some(v => v.id === video.id)) return;
      this.readyVideos = [...this.readyVideos, video];
      this.dismissed.delete(`video-${video.id}`); // being ready is news
      this.announcement = `“${video.title}” is ready to watch.`;
      this.autoHide(video.id);
      this.rebuild();
    }));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.hideTimers.forEach(timer => clearTimeout(timer));
    this.renderer.removeClass(this.document.body, 'ss-has-upload-card');
  }

  hide(item: UploadStatusItem): void {
    this.dismissed.add(item.key);
    clearTimeout(this.hideTimers.get(item.key));
    this.hideTimers.delete(item.key);
    this.rebuild();
  }

  // ── Per-card text (shared with the upload page) ─────────────────────────────

  tone = statusTone;
  statusText = statusLabel;
  detailText = statusDetail;
  title = statusTitle;
  progress = statusProgress;
  indeterminate = statusIndeterminate;
  watchId = statusWatchId;

  poster(item: UploadStatusItem): string | null {
    return item.job?.poster ?? null;
  }

  trackByKey(_: number, item: UploadStatusItem): string {
    return item.key;
  }

  // ── Building the list ───────────────────────────────────────────────────────

  private rebuild(): void {
    this.items = buildStatusItems(this.uploads.jobs, this.processing, this.readyVideos)
      .filter(item => !this.dismissed.has(item.key))
      .slice(0, MAX_CARDS);
    this.syncBodyClass();
  }

  private autoHide(key: string): void {
    if (this.hideTimers.has(key)) return;
    this.hideTimers.set(key, setTimeout(() => {
      this.dismissed.add(key);
      this.hideTimers.delete(key);
      this.readyVideos = this.readyVideos.filter(v => `video-${v.id}` !== key && v.id !== key);
      this.rebuild();
    }, READY_VISIBLE_MS));
  }

  private announce(job: UploadJob | null): string {
    if (!job) return '';
    switch (job.phase) {
      case 'queued':     return `“${job.title}” is waiting to upload.`;
      case 'uploading':  return `Uploading “${job.title}”.`;
      case 'saving':     return 'Finishing the upload.';
      case 'processing': return `“${job.title}” uploaded. Processing has started.`;
      case 'ready':      return `“${job.title}” is ready to watch.`;
      case 'failed':     return `The upload of “${job.title}” failed.`;
      default:           return '';
    }
  }

  /** Lets toasts move up while the cards occupy the bottom edge. */
  private syncBodyClass(): void {
    if (this.items.length > 0 && !this.onUploadPage) {
      this.renderer.addClass(this.document.body, 'ss-has-upload-card');
    } else {
      this.renderer.removeClass(this.document.body, 'ss-has-upload-card');
    }
  }

  private readUrl(url: string): void {
    this.onUploadPage = (url || '/').split(/[?#]/)[0] === '/upload';
  }
}
