import {
  Component, OnInit, OnDestroy, ChangeDetectorRef,
  HostListener, ViewChild, ElementRef, inject,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { CommonModule }        from '@angular/common';
import { RouterModule }        from '@angular/router';
import { MatDialog }           from '@angular/material/dialog';
import { UploadVideoComponent } from '../upload-video/upload-video.component';
import { MatButtonModule }     from '@angular/material/button';
import { MatIconModule }       from '@angular/material/icon';
import { MatMenuModule }       from '@angular/material/menu';
import { MatDividerModule }    from '@angular/material/divider';
import { MatTooltipModule }    from '@angular/material/tooltip';
import { UserLoginComponent }  from '../user-login/user-login.component';
import { Router }              from '@angular/router';
import { AuthService }         from '../../services/auth.service';
import { ThemeService }        from '../../services/theme.service';
import { VideoService }        from '../../services/video.service';
import { Subscription }        from 'rxjs';
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
  isScrolled  = false;
  searchOpen  = false;
  searchTerm  = '';
  selectedCategory = 'All';

  isLoggedIn   = false;
  user: User | null = null;
  profileImage = '';

  private readonly DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNlNWU3ZWYiLz4KPHBhdGggZD0iTTIwIDEwQzIyLjA5IDEwIDI0IDEyLjA5IDI0IDE0QzI0IDE1LjkxIDIyLjA5IDE4IDIwIDE4QzE3LjkxIDE4IDE2IDE1LjkxIDE2IDE0QzE2IDEyLjA5IDE3LjkxIDEwIDIwIDEwWk0yMCAyMEMyMi4wOSAyMCAyNCAyMi4wOSAyNCAyNEMyNCAyNS45MSAyMi4wOSAyOCAyMCAyOEMxNy45MSAyOCAxNiAyNS45MSAxNiAyNEMxNiAyMi4wOSAxNy45MSAyMCAyMCAyMFoiIGZpbGw9IiM5Y2EzYWYiLz4KPC9zdmc+';
  private loginSubscription: Subscription | null = null;

  // ── Categories (from the retired category-slider) ────────────────────────
  readonly categories: string[] = [
    'Music', 'Gaming', 'Sports', 'Movies', 'Comedy', 'Web Series',
    'Learning', 'Podcasts', 'News', 'Fitness', 'Vlogs', 'Travel',
    'Tech', 'Food & Recipes', 'Motivation', 'Short Films', 'Art & Design',
    'Fashion', 'Kids', 'History', 'DIY', 'Documentaries', 'Spirituality',
    'Real Estate', 'Automotive', 'Science', 'Nature', 'Animals',
    'Health & Wellness', 'Business & Finance', 'Personal Development',
    'Unboxing & Reviews', 'Live Streams', 'Events & Conferences',
    'Memes & Challenges', 'Festivals', 'Interviews', 'Trailers & Teasers',
    'Animation', 'Magic & Illusions', 'Comedy Skits', 'Parodies',
    'Reaction Videos', 'ASMR',
  ];

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
    this.loginSubscription = this.authService.getLoginState().subscribe(loggedIn => {
      this.isLoggedIn = loggedIn;
      this.loadUserData();
      setTimeout(() => this.cdr.detectChanges());
    });
  }

  ngOnDestroy(): void {
    this.loginSubscription?.unsubscribe();
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

  // ── Close search when clicking outside the header ────────────────────────
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.searchOpen && !this.hostEl.nativeElement.contains(event.target as Node)) {
      this.closeSearch();
    }
  }

  // ── User data ────────────────────────────────────────────────────────────
  loadUserData(): void {
    try {
      const raw = localStorage.getItem('user');
      if (raw) {
        this.user        = JSON.parse(raw);
        this.isLoggedIn  = true;
        this.profileImage = this.user?.profileImage || this.DEFAULT_AVATAR;
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

  onImageError(event: any): void {
    event.target.src = this.DEFAULT_AVATAR;
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  navigateToHome():    void { this.router.navigate(['/home']); }
  navigateToProfile(): void { this.router.navigate(['/user-profile']); this.closeSearch(); }
  navigateToUpload(): void {
    this.closeSearch();
    this.dialog.open(UploadVideoComponent, {
      width: '560px',
      maxWidth: '96vw',
      panelClass: 'ss-upload-dialog',
      autoFocus: true,
      restoreFocus: true,
    });
  }
  navigateToHistory(): void { this.router.navigate(['/history']); this.closeSearch(); }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/home']);
  }

  // ── Search panel ─────────────────────────────────────────────────────────
  toggleSearch(): void {
    this.searchOpen = !this.searchOpen;
    if (this.searchOpen) {
      // Focus the input after it animates in
      setTimeout(() => this.searchInput?.nativeElement?.focus(), 150);
    }
  }

  closeSearch(): void {
    this.searchOpen = false;
  }

  onSearchInput(event: any): void {
    this.searchTerm = event.target.value;
    // No local debounce here — VideoListComponent already applies debounceTime(350)
    // on the search$ stream, so we emit immediately.
    this.videoService.setSearchTerm(this.searchTerm.toLowerCase());
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.videoService.setSearchTerm('');
    this.searchInput?.nativeElement?.focus();
  }

  selectCategory(cat: string): void {
    this.selectedCategory = cat;
    this.videoService.setCategory(cat);
  }
}
