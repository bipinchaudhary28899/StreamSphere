import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, ChangeDetectorRef,
} from '@angular/core';
import { VideoService } from '../../services/video.service';
import { VideoCardComponent } from '../video-card/video-card.component';
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { HeroCarouselComponent } from '../hero-carousel/hero-carousel.component';

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
  ) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadFirstPage();

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
        const intersecting = entries[0].isIntersecting;
        console.log(`[VideoList] IntersectionObserver fired: intersecting=${intersecting}, hasMore=${this.hasMore}, isLoadingMore=${this.isLoadingMore}, isSearchMode=${this.isSearchMode}`);
        if (intersecting && this.hasMore && !this.isLoadingMore && !this.isSearchMode) {
          this.loadNextPage();
        }
      },
      { rootMargin: '200px' }, // start loading 200px before the sentinel is visible
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
      console.log('[VideoList] IntersectionObserver attached to sentinel');
    } else {
      console.log('[VideoList] attachSentinel: sentinel not in DOM yet (will attach after first page)');
    }
  }

  // ── Load helpers ─────────────────────────────────────────────────────────────

  /** Called on initial load or after filter/category reset */
  loadFirstPage(): void {
    this.isLoading       = true;
    this.isSearchMode    = false;
    this.error           = null;
    this.displayedVideos = [];
    this.nextCursor      = null;
    this.hasMore         = false;

    console.log(`[VideoList] loadFirstPage  category=${this.currentCategory}`);

    this.videoService.getFeed(undefined, this.currentCategory).subscribe({
      next: (page) => {
        console.log(`[VideoList] loadFirstPage received: ${page.videos.length} video(s), hasMore=${page.hasMore}, nextCursor=${page.nextCursor ?? 'null'}`);
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
        console.error('[VideoList] loadFirstPage error:', err);
      },
    });
  }

  /** Alias used by the Retry button in the template */
  loadVideos = () => this.loadFirstPage();

  /** Load the next cursor page and append to grid */
  loadNextPage(): void {
    if (!this.hasMore || this.isLoadingMore || !this.nextCursor) return;

    this.isLoadingMore = true;
    console.log(`[VideoList] loadNextPage  cursor=${this.nextCursor}  category=${this.currentCategory}  currentTotal=${this.displayedVideos.length}`);

    this.videoService.getFeed(this.nextCursor, this.currentCategory).subscribe({
      next: (page) => {
        console.log(`[VideoList] loadNextPage received: ${page.videos.length} video(s), hasMore=${page.hasMore}, nextCursor=${page.nextCursor ?? 'null'}`);
        this.displayedVideos = [...this.displayedVideos, ...page.videos];
        this.nextCursor      = page.nextCursor;
        this.hasMore         = page.hasMore;
        this.isLoadingMore   = false;
        console.log(`[VideoList] grid now has ${this.displayedVideos.length} total video(s)`);
      },
      error: (err) => {
        this.isLoadingMore = false;
        console.error('[VideoList] loadNextPage error:', err);
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

    console.log(`[VideoList] runSearch  term="${term}"  category=${this.currentCategory}`);

    this.videoService.searchVideos(term, this.currentCategory).subscribe({
      next: ({ videos }) => {
        console.log(`[VideoList] search returned ${videos.length} result(s)`);
        this.displayedVideos = videos;
        this.isLoading       = false;
      },
      error: (err) => {
        this.error     = 'Search failed. Please try again.';
        this.isLoading = false;
        console.error('[VideoList] search error:', err);
      },
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
