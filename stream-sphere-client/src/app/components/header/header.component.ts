import {
  Component, OnInit, OnDestroy, ChangeDetectorRef,
  HostListener, ViewChild, ElementRef, inject,
} from '@angular/core';
import { CommonModule }        from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { MatDialog }           from '@angular/material/dialog';
import { UploadVideoComponent, UPLOAD_DIALOG_CONFIG } from '../upload-video/upload-video.component';
import { MatButtonModule }     from '@angular/material/button';
import { MatIconModule }       from '@angular/material/icon';
import { MatMenuModule }       from '@angular/material/menu';
import { MatDividerModule }    from '@angular/material/divider';
import { MatTooltipModule }    from '@angular/material/tooltip';
import { UserLoginComponent }  from '../user-login/user-login.component';
import { AuthService }         from '../../services/auth.service';
import { ThemeService }        from '../../services/theme.service';
import { VideoService }        from '../../services/video.service';
import { Subscription, filter } from 'rxjs';
import { User }                from '../../models/user';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule, RouterModule,
    MatButtonModule, MatIconModule, MatMenuModule, MatDividerModule, MatTooltipModule,
    UserLoginComponent,
  ],
  templateUrl: './header.component.html',
  styleUrls:  ['./header.component.css'],
})
export class HeaderComponent implements OnInit, OnDestroy {

  // ── State ────────────────────────────────────────────────────────────────
  isScrolled       = false;
  /** Small screens: the search field opens as a row under the bar. */
  mobileSearchOpen = false;
  searchTerm       = '';

  isLoggedIn   = false;
  user: User | null = null;
  profileImage = '';
  avatarFailed = false;

  /** True on the home feed, where the bar sits over the hero. */
  private isHomeRoute = true;
  private activeCategory = 'All';

  private readonly DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNlNWU3ZWYiLz4KPHBhdGggZD0iTTIwIDEwQzIyLjA5IDEwIDI0IDEyLjA5IDI0IDE0QzI0IDE1LjkxIDIyLjA5IDE4IDIwIDE4QzE3LjkxIDE4IDE2IDE1LjkxIDE2IDE0QzE2IDEyLjA5IDE3LjkxIDEwIDIwIDEwWk0yMCAyMEMyMi4wOSAyMCAyNCAyMi4wOSAyNCAyNEMyNCAyNS45MSAyMi4wOSAyOCAyMCAyOEMxNy45MSAyOCAxNiAyNS45MSAxNiAyNEMxNiAyMi4wOSAxNy45MSAyMCAyMCAyMFoiIGZpbGw9IiM5Y2EzYWYiLz4KPC9zdmc+';
  private subs: Subscription[] = [];

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  private readonly hostEl = inject(ElementRef<HTMLElement>);

  constructor(
    private router:       Router,
    private authService:  AuthService,
    private videoService: VideoService,
    private cdr:          ChangeDetectorRef,
    public  themeService: ThemeService,
    private dialog:       MatDialog,
  ) { }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.loadUserData();
    this.isHomeRoute = this.isHomeUrl(this.router.url);

    this.subs.push(
      this.authService.getLoginState().subscribe(loggedIn => {
        this.isLoggedIn = loggedIn;
        this.loadUserData();
        setTimeout(() => this.cdr.detectChanges());
      }),
      this.router.events
        .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
        .subscribe(e => {
          this.isHomeRoute = this.isHomeUrl(e.urlAfterRedirects);
          this.mobileSearchOpen = false;
        }),
      this.videoService.category$.subscribe(cat => this.activeCategory = cat),
      this.videoService.search$.subscribe(term => {
        // Keep the field in sync when another view clears the search.
        if (!term && this.searchTerm) this.searchTerm = '';
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  /** Transparent over the home hero; solid everywhere else. */
  get overlayMode(): boolean {
    return this.isHomeRoute
      && !this.isScrolled
      && !this.mobileSearchOpen
      && !this.searchTerm
      && this.activeCategory === 'All';
  }

  private isHomeUrl(url: string): boolean {
    const path = (url || '/').split(/[?#]/)[0];
    return path === '/' || path === '/home';
  }

  // ── Scroll listener (transparent → solid) ────────────────────────────────
  // Listen to BOTH window and document scroll events.
  // When body is the scroll container (can happen with overflow-x:hidden on body),
  // only the document scroll event fires. Covering both ensures it always works.
  @HostListener('window:scroll')
  @HostListener('document:scroll')
  onWindowScroll(): void {
    const scrollY =
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;
    const scrolled = scrollY > 30;
    if (scrolled !== this.isScrolled) {
      this.isScrolled = scrolled;
      this.cdr.detectChanges(); // force update — scroll fires outside zone on some builds
    }
  }

  // ── Close the mobile search row when clicking outside the header ─────────
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.mobileSearchOpen && !this.hostEl.nativeElement.contains(event.target as Node)) {
      this.closeSearch();
    }
  }

  // ── "/" focuses search, as on most video sites ───────────────────────────
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    event.preventDefault();
    if (window.matchMedia('(max-width: 768px)').matches) this.mobileSearchOpen = true;
    setTimeout(() => this.searchInput?.nativeElement?.focus());
  }

  // ── User data ────────────────────────────────────────────────────────────
  loadUserData(): void {
    try {
      const raw = localStorage.getItem('user');
      if (raw) {
        this.user         = JSON.parse(raw);
        this.isLoggedIn   = true;
        this.profileImage = this.user?.profileImage || '';
        this.avatarFailed = false;
      } else {
        this.resetUser();
      }
    } catch {
      this.resetUser();
    }
  }

  private resetUser(): void {
    this.isLoggedIn   = false;
    this.user         = null;
    this.profileImage = this.DEFAULT_AVATAR;
  }

  get initials(): string {
    const name = (this.user?.name || '').trim();
    if (!name) return 'U';
    const parts = name.split(/\s+/);
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  onImageError(event: any): void {
    // Fall back to the initials avatar instead of a broken image.
    this.avatarFailed = true;
    if (event?.target) event.target.src = this.DEFAULT_AVATAR;
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  get isAdmin(): boolean { return this.user?.email === 'bkumar28899@gmail.com'; }

  navigateToHome():    void { this.router.navigate(['/home']); }
  navigateToProfile(): void { this.router.navigate(['/user-profile']); this.closeSearch(); }
  navigateToAdmin():   void { this.router.navigate(['/admin']); this.closeSearch(); }
  navigateToUpload(): void {
    this.closeSearch();
    this.dialog.open(UploadVideoComponent, UPLOAD_DIALOG_CONFIG);
  }
  navigateToHistory(): void { this.router.navigate(['/history']); this.closeSearch(); }

  /** Logo on the home page resets filters and scrolls to the top. */
  onBrandClick(): void {
    if (this.isHomeRoute) {
      this.searchTerm = '';
      this.videoService.setSearchTerm('');
      this.videoService.setCategory('All');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/home']);
  }

  // ── Search ───────────────────────────────────────────────────────────────
  toggleSearch(): void {
    this.mobileSearchOpen = !this.mobileSearchOpen;
    if (this.mobileSearchOpen) {
      setTimeout(() => this.searchInput?.nativeElement?.focus(), 50);
    }
  }

  closeSearch(): void {
    this.mobileSearchOpen = false;
  }

  onSearchInput(event: Event): void {
    this.searchTerm = (event.target as HTMLInputElement).value;
    // No local debounce here — VideoListComponent already applies debounceTime(350)
    // on the search$ stream, so we emit immediately.
    this.videoService.setSearchTerm(this.searchTerm.toLowerCase());
    // Results render in the home feed.
    if (this.searchTerm.trim() && !this.isHomeRoute) this.router.navigate(['/home']);
  }

  onSearchSubmit(event: Event): void {
    event.preventDefault();
    if (!this.searchTerm.trim()) return;
    if (!this.isHomeRoute) this.router.navigate(['/home']);
    // Drop the on-screen keyboard so results are visible.
    if (window.matchMedia('(max-width: 768px)').matches) this.searchInput?.nativeElement?.blur();
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.videoService.setSearchTerm('');
    this.searchInput?.nativeElement?.focus();
  }
}
