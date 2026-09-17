import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin, of, Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { VideoService } from '../../services/video.service';
import { VideoCardComponent } from '../video-card/video-card.component';
import { AuthService } from '../../services/auth.service';
import { User } from '../../models/user';

export type ProfileTab = 'videos' | 'liked' | 'disliked' | 'manage';

interface ProfileTabDef {
  id: ProfileTab;
  label: string;
}

/** One list of videos plus its request state */
interface VideoList {
  items: any[];
  loading: boolean;
  failed: boolean;
}

interface EmptyCopy {
  icon: string;
  title: string;
  hint: string;
}

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    VideoCardComponent,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatCheckboxModule,
    MatIconModule,
  ],
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.css',
})
export class UserProfileComponent implements OnInit, AfterViewInit, OnDestroy {
  user: User | null = null;
  userName = '';
  userEmail = '';
  profileImage = '';
  avatarFailed = false;

  readonly tabs: ProfileTabDef[] = [
    { id: 'videos', label: 'Videos' },
    { id: 'liked', label: 'Liked' },
    { id: 'disliked', label: 'Disliked' },
    { id: 'manage', label: 'Manage' },
  ];
  activeTab: ProfileTab = 'videos';

  mine: VideoList = { items: [], loading: true, failed: false };
  liked: VideoList = { items: [], loading: true, failed: false };
  disliked: VideoList = { items: [], loading: true, failed: false };

  private readonly emptyCopy: Record<'videos' | 'liked' | 'disliked', EmptyCopy> = {
    videos: {
      icon: 'video_call',
      title: 'Upload your first video',
      hint: 'Videos you upload will show up here.',
    },
    liked: {
      icon: 'thumb_up_off_alt',
      title: 'No liked videos yet',
      hint: 'Give a video a thumbs-up and it will show up here.',
    },
    disliked: {
      icon: 'thumb_down_off_alt',
      title: 'No disliked videos',
      hint: 'Videos you give a thumbs-down will show up here.',
    },
  };

  /** Channel totals, recalculated when your videos load */
  totalViews = 0;
  totalLikes = 0;
  processingCount = 0;

  // ── Manage table ───────────────────────────────────────────────────────────
  readonly displayedColumns = ['select', 'video', 'status', 'views', 'likes', 'uploadedAt'];
  dataSource = new MatTableDataSource<any>([]);
  selection = new Set<string>();
  deleting = false;

  toast: { message: string; error: boolean } | null = null;
  readonly skeletons = Array.from({ length: 8 });
  readonly rowSkeletons = Array.from({ length: 4 });

  private subscriptions = new Subscription();
  private toastTimer?: ReturnType<typeof setTimeout>;

  /** Attached whenever the Manage tab renders the table */
  @ViewChild(MatPaginator) set paginator(paginator: MatPaginator | undefined) {
    this.dataSource.paginator = paginator ?? null;
  }
  @ViewChild(MatSort) set sort(sort: MatSort | undefined) {
    this.dataSource.sort = sort ?? null;
  }
  @ViewChildren('tabButton') private tabButtons!: QueryList<ElementRef<HTMLButtonElement>>;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private videoService: VideoService,
    private authService: AuthService,
  ) {
    this.dataSource.sortingDataAccessor = (row: any, column: string) => {
      switch (column) {
        case 'title':      return (row.title || '').toLowerCase();
        case 'views':      return row.views || 0;
        case 'likes':      return row.likes || 0;
        case 'uploadedAt': return new Date(row.uploadedAt).getTime() || 0;
        default:           return row[column] ?? '';
      }
    };
  }

  ngOnInit(): void {
    this.loadUserData();
    if (!this.user) return;

    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (this.isTab(tab)) this.activeTab = tab;

    this.loadMyVideos();
    this.loadLikedVideos();
    this.loadDislikedVideos();

    // Uploads (from any entry point) and deletes refresh "Your videos"
    this.subscriptions.add(
      this.videoService.feedRefresh$.subscribe(() => this.loadMyVideos()),
    );
  }

  ngAfterViewInit(): void {
    // A deep link (?tab=manage) may point at a tab that starts off-screen on phones
    this.revealTab(this.activeTab, 'auto');
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    clearTimeout(this.toastTimer);
  }

  loadUserData(): void {
    try {
      const userData = localStorage.getItem('user');
      if (!userData) {
        this.router.navigate(['/login']);
        return;
      }
      this.user = JSON.parse(userData);
      this.userName = this.user?.name || 'Your channel';
      this.userEmail = this.user?.email || '';
      this.profileImage = this.user?.profileImage || '';
    } catch (error) {
      console.error('UserProfile: Error loading user data:', error);
      this.router.navigate(['/login']);
    }
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  loadMyVideos(): void {
    if (!this.user) return;
    this.mine = { ...this.mine, loading: this.mine.items.length === 0, failed: false };

    this.videoService.getMyVideos().subscribe({
      next: (videos: any[]) => {
        const items = videos || [];
        this.mine = { items, loading: false, failed: false };
        this.dataSource.data = items;
        this.updateStats(items);

        // Drop selections for videos that no longer exist
        const ids = new Set(items.map(v => v._id));
        this.selection.forEach(id => { if (!ids.has(id)) this.selection.delete(id); });
      },
      error: (err: any) => {
        console.error('Error loading user videos:', err);
        if (this.mine.items.length > 0) {
          // A background refresh failed: keep what's on screen
          this.mine = { ...this.mine, loading: false };
          this.showToast('Couldn’t refresh your videos. Reload the page to try again.', true);
        } else {
          this.mine = { ...this.mine, loading: false, failed: true };
        }
      },
    });
  }

  loadLikedVideos(): void {
    if (!this.user) return;
    this.liked = { ...this.liked, loading: true, failed: false };
    this.videoService.getLikedVideos().subscribe({
      next: (videos) => (this.liked = { items: videos || [], loading: false, failed: false }),
      error: (err) => {
        console.error('Error loading liked videos:', err);
        this.liked = { ...this.liked, loading: false, failed: true };
      },
    });
  }

  loadDislikedVideos(): void {
    if (!this.user) return;
    this.disliked = { ...this.disliked, loading: true, failed: false };
    this.videoService.getDislikedVideos().subscribe({
      next: (videos) => (this.disliked = { items: videos || [], loading: false, failed: false }),
      error: (err) => {
        console.error('Error loading disliked videos:', err);
        this.disliked = { ...this.disliked, loading: false, failed: true };
      },
    });
  }

  retry(tab: ProfileTab): void {
    if (tab === 'liked') this.loadLikedVideos();
    else if (tab === 'disliked') this.loadDislikedVideos();
    else this.loadMyVideos();
  }

  listFor(tab: ProfileTab): VideoList {
    if (tab === 'liked') return this.liked;
    if (tab === 'disliked') return this.disliked;
    return this.mine;
  }

  emptyFor(tab: ProfileTab): EmptyCopy {
    return tab === 'manage' ? this.emptyCopy.videos : this.emptyCopy[tab];
  }

  countFor(tab: ProfileTab): number | null {
    if (tab === 'manage') return null;
    const list = this.listFor(tab);
    return list.loading || list.failed ? null : list.items.length;
  }

  private updateStats(videos: any[]): void {
    this.totalViews = videos.reduce((sum, v) => sum + (v.views || 0), 0);
    this.totalLikes = videos.reduce((sum, v) => sum + (v.likes || 0), 0);
    this.processingCount = videos.filter(v => v.status === 'processing').length;
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────

  selectTab(tab: ProfileTab): void {
    if (tab === this.activeTab) return;
    this.activeTab = tab;
    this.revealTab(tab);

    // Keep the tab in the URL so reloads and shared links land on it
    const url = this.router
      .createUrlTree([], {
        relativeTo: this.route,
        queryParams: { tab: tab === 'videos' ? null : tab },
        queryParamsHandling: 'merge',
      })
      .toString();
    this.location.replaceState(url);
  }

  /** Arrow keys move between tabs (WAI-ARIA tabs pattern, automatic activation) */
  onTabKeydown(event: KeyboardEvent, index: number): void {
    const last = this.tabs.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = index === last ? 0 : index + 1; break;
      case 'ArrowLeft':  next = index === 0 ? last : index - 1; break;
      case 'Home':       next = 0; break;
      case 'End':        next = last; break;
      default: return;
    }
    event.preventDefault();
    this.selectTab(this.tabs[next].id);
    this.tabButtons.get(next)?.nativeElement.focus();
  }

  /** Scrolls the tab row sideways (only) so the given tab is fully visible. */
  private revealTab(tab: ProfileTab, behavior: ScrollBehavior = 'smooth'): void {
    const button = this.tabButtons?.get(this.tabs.findIndex(t => t.id === tab))?.nativeElement;
    const row = button?.parentElement;
    if (!button || !row) return;

    const rowBox = row.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    const margin = 16;
    if (box.left < rowBox.left) {
      row.scrollBy({ left: box.left - rowBox.left - margin, behavior });
    } else if (box.right > rowBox.right) {
      row.scrollBy({ left: box.right - rowBox.right + margin, behavior });
    }
  }

  private isTab(value: string | null): value is ProfileTab {
    return this.tabs.some(t => t.id === value);
  }

  // ── Manage: selection + delete ─────────────────────────────────────────────

  isAllSelected(): boolean {
    const rows = this.dataSource.data.length;
    return rows > 0 && this.selection.size === rows;
  }

  masterToggle(): void {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.dataSource.data.forEach((row) => this.selection.add(row._id));
    }
  }

  toggleSelection(id: string): void {
    if (this.selection.has(id)) {
      this.selection.delete(id);
    } else {
      this.selection.add(id);
    }
  }

  clearSelection(): void {
    this.selection.clear();
  }

  deleteSelected(): void {
    const ids = Array.from(this.selection);
    const userId = this.user?.userId;
    if (ids.length === 0 || !userId || this.deleting) return;

    const what = ids.length === 1 ? 'this video' : `these ${ids.length} videos`;
    if (!confirm(`Delete ${what}? This can’t be undone.`)) return;

    this.deleting = true;
    const requests = ids.map((id) =>
      this.videoService.deleteVideo(id, userId).pipe(
        map(() => true),
        catchError((err) => {
          console.error(`Failed to delete video ${id}:`, err);
          return of(false);
        }),
      ),
    );

    forkJoin(requests).subscribe((results) => {
      this.deleting = false;
      // Keep failed rows selected so they can be retried
      ids.forEach((id, i) => { if (results[i]) this.selection.delete(id); });

      const deleted = results.filter(Boolean).length;
      const failed = ids.length - deleted;
      if (deleted > 0) this.videoService.triggerFeedRefresh();

      if (failed === 0) {
        this.showToast(`Deleted ${deleted} ${deleted === 1 ? 'video' : 'videos'}`);
      } else {
        this.showToast(`Couldn’t delete ${failed} of ${ids.length} ${ids.length === 1 ? 'video' : 'videos'}. Try again.`, true);
      }
    });
  }

  showToast(message: string, error = false): void {
    clearTimeout(this.toastTimer);
    this.toast = { message, error };
    this.toastTimer = setTimeout(() => (this.toast = null), 4000);
  }

  dismissToast(): void {
    clearTimeout(this.toastTimer);
    this.toast = null;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  onAvatarError(): void {
    this.avatarFailed = true;
  }

  // ── View helpers ───────────────────────────────────────────────────────────

  /** Same rule as the header avatar: first + last initial */
  get initials(): string {
    const parts = (this.userName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'U';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  formatCount(value: number): string {
    const n = value || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'K';
    return n.toString();
  }

  plural(count: number, one: string, many: string): string {
    return `${this.formatCount(count)} ${count === 1 ? one : many}`;
  }

  trackById(index: number, video: any) {
    return video?._id ?? index;
  }
}
