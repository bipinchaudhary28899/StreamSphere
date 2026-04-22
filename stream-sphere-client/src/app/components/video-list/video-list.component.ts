import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, ChangeDetectorRef,
} from '@angular/core';
import { VideoService } from '../../services/video.service';
import { VideoCardComponent } from '../video-card/video-card.component';
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription, debounceTime, distinctUntilChanged, filter } from 'rxjs';
import { HeroCarouselComponent } from '../hero-carousel/hero-carousel.component';
import { UploadStatusService, ProcessingVideo } from '../../services/upload-status.service';

@Component({
  selector: 'app-video-list',
  templateUrl: './video-list.component.html',
  styleUrls: ['./video-list.component.scss'],
  standalone: true,
  imports: [
    VideoCardComponent, MatIcon, CommonModule,
    MatProgressSpinnerModule, HeroCarouselComponent,
  ],
})
export class VideoListComponent implements OnInit, AfterViewInit, OnDestroy {

  // ── State ────────────────────────────────────────────────────────────────────
  displayedVideos: any[] = [];   // accumulates pages for the grid
  isLoading       = true;        // initial load spinner
  isLoadingMore   = false;       // "load more" spinner at bottom
  error: string | null = null;

  // ── Upload processing notification ───────────────────────────────────────────
  processingVideos: ProcessingVideo[] = [];
  readyToast: string | null = null;          // title of video that just became ready
  private readyToastTimer: any = null;

  // Pagination
  private nextCursor: string | null = null;
  hasMore = false;

  // Active filters
  currentCategory = 'All';
  private currentSearch = '';
  isSearchMode  = false; // true → server-side search, no infinite scroll (used in template)

  // ── Subscriptions / cleanup ───────────────────────────────────────────────────
  private subs: Subscription[] = [];
  private observer!: IntersectionObserver;

  // Sentinel element at the bottom of the grid — triggers next page load
  @ViewChild('sentinel') sentinelRef!: ElementRef<HTMLDivElement>;

  constructor(
    private videoService: VideoService,
    private cdr: ChangeDetectorRef,
    private uploadStatus: UploadStatusService,
  ) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadFirstPage();
    this.checkOwnProcessingVideos();

    // Refresh feed after a new video is uploaded
    this.subs.push(
      this.videoService.feedRefresh$.subscribe(() => {
        this.resetAndLoad();
      }),
    );

    // Track processing videos and show banner / ready toast
    this.subs.push(
      this.uploadStatus.processing$.subscribe(list => {
        this.processingVideos = list;
        this.cdr.detectChanges();
      }),
    );

    this.subs.push(
      this.uploadStatus.ready$.pipe(filter(id => !!id)).subscribe(id => {
        const video = this.processingVideos.find(v => v.id === id);
        this.readyToast = video ? `"${video.title}" is ready!` : 'Your video is ready!';
        this.cdr.detectChanges();
        // Refresh the feed so the video appears in the grid
        this.resetAndLoad();
        // Auto-dismiss the toast after 5 seconds
        clearTimeout(this.readyToastTimer);
        this.readyToastTimer = setTimeout(() => {
          this.readyToast = null;
          this.cdr.detectChanges();
        }, 5000);
      }),
    );

    // React to category changes from the header.
    // If a search is already active, re-run it scoped to the new category
    // instead of switching back to the paginated feed.
    this.subs.push(
      this.videoService.category$.subscribe(cat => {
        if (cat === this.currentCategory) return;
        this.currentCategory = cat;
        if (this.currentSearch.trim().length >= 2) {
          this.runSearch(this.currentSearch.trim());
        } else {
          this.resetAndLoad();
        }
      }),
    );

    // React to search from the header — debounce so we don't spam the API.
    // NOTE: search$ is a BehaviorSubject and emits '' immediately on subscribe.
    // We must NOT call resetAndLoad() on that cold initial emission — only when
    // the user actually clears an active search (isSearchMode === true).
    this.subs.push(
      this.videoService.search$.pipe(debounceTime(350), distinctUntilChanged()).subscribe(term => {
        this.currentSearch = term;
        if (term.trim().length >= 2) {
          this.runSearch(term.trim());
        } else if (this.isSearchMode) {
          // Search was active and user cleared it — go back to paginated feed
          this.isSearchMode = false;
          this.resetAndLoad();
        }
        // else: initial empty emission — do nothing, loadFirstPage() already ran
      }),
    );
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.observer?.disconnect();
  }

  // ── IntersectionObserver ──────────────────────────────────────────────────────

  private setupIntersectionObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && this.hasMore && !this.isLoadingMore && !this.isSearchMode) {
          this.loadNextPage();
        }
      },
      // 800px rootMargin = start fetching the next batch when the sentinel
      // is still ~800px below the viewport — roughly 2-3 card rows away —
      // so the new cards are ready before the user even gets close to the end.
      { rootMargin: '800px' },
    );

    // The sentinel lives inside *ngIf="!isLoading" so it may not exist yet
    // during ngAfterViewInit. attachSentinel() is called after the first page
    // renders to actually start observing the element.
    this.attachSentinel();
  }

  /** Connect the IntersectionObserver to the sentinel div.
   *  Safe to call multiple times — observe() is idempotent. */
  private attachSentinel(): void {
    if (this.sentinelRef?.nativeElement && this.observer) {
      this.observer.observe(this.sentinelRef.nativeElement);
    }
  }

  // ── Load helpers ─────────────────────────────────────────────────────────────

  /** Called on initial load or after filter/category reset */
  loadFirstPage(): void {
    this.isSearchMode    = false;
    this.error           = null;
    this.nextCursor      = null;
    this.hasMore         = false;

    // Only show the full skeleton block on a cold load (no videos yet).
    // On refreshes (e.g. after upload) keep existing videos visible so
    // the user can still click them while new data loads in background.
    if (!this.displayedVideos.length) {
      this.isLoading = true;
    }

    this.videoService.getFeed(undefined, this.currentCategory).subscribe({
      next: (page) => {
        this.displayedVideos = page.videos;
        this.nextCursor      = page.nextCursor;
        this.hasMore         = page.hasMore;
        this.isLoading       = false;
        // Sentinel lives inside *ngIf — force a CD pass so it appears in
        // the DOM, then attach the IntersectionObserver to it.
        this.cdr.detectChanges();
        this.attachSentinel();
      },
      error: (err) => {
        this.error     = 'Failed to load videos. Please try again.';
        this.isLoading = false;
        console.error('Failed to load feed:', err);
      },
    });
  }

  /** Alias used by the Retry button in the template */
  loadVideos = () => this.loadFirstPage();

  /** Load the next cursor page and append to grid */
  loadNextPage(): void {
    if (!this.hasMore || this.isLoadingMore || !this.nextCursor) return;

    this.isLoadingMore = true;

    this.videoService.getFeed(this.nextCursor, this.currentCategory).subscribe({
      next: (page) => {
        this.displayedVideos = [...this.displayedVideos, ...page.videos];
        this.nextCursor      = page.nextCursor;
        this.hasMore         = page.hasMore;
        this.isLoadingMore   = false;
      },
      error: (err) => {
        this.isLoadingMore = false;
        console.error('Failed to load next page:', err);
      },
    });
  }

  /** Reset cursor state and reload from page 1 */
  private resetAndLoad(): void {
    this.isSearchMode = false;
    this.loadFirstPage();
  }

  /** Server-side search — replaces the grid, no infinite scroll */
  private runSearch(term: string): void {
    this.isLoading       = true;
    this.isSearchMode    = true;
    this.error           = null;
    this.displayedVideos = [];
    this.hasMore         = false;

    this.videoService.searchVideos(term, this.currentCategory).subscribe({
      next: ({ videos }) => {
        this.displayedVideos = videos;
        this.isLoading       = false;
      },
      error: (err) => {
        this.error     = 'Search failed. Please try again.';
        this.isLoading = false;
        console.error('Search failed:', err);
      },
    });
  }

  // ── Processing recovery ───────────────────────────────────────────────────────
  // On page load/refresh, check if the logged-in user has any videos still in
  // 'processing' state and register them with UploadStatusService so the banner
  // and ready-toast work even after a page refresh.
  private checkOwnProcessingVideos(): void {
    const userData = localStorage.getItem('user');
    if (!userData) return;

    this.videoService.getMyVideos().subscribe({
      next: (videos: any[]) => {
        videos
          .filter((v: any) => v.status === 'processing')
          .forEach((v: any) => this.uploadStatus.track(v._id, v.title));
      },
      error: () => {} // silently ignore — non-critical
    });
  }

  // ── Event handlers ────────────────────────────────────────────────────────────

  onVideoDeleted(videoId: string): void {
    this.displayedVideos = this.displayedVideos.filter(v => v._id !== videoId);
  }

  trackById(_: number, video: any): string {
    return video._id;
  }
}
