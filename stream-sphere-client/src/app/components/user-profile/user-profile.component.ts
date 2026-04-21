import { Component, OnInit, ViewChild, HostListener } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { UploadVideoComponent } from '../upload-video/upload-video.component';
import { MatCardModule } from '@angular/material/card';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { VideoService } from '../../services/video.service';
import { VideoCardComponent } from '../video-card/video-card.component';
import { AuthService } from '../../services/auth.service';
import { Subscription } from 'rxjs';
import { User } from '../../models/user';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

// Using shared User interface from models

@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [
    MatCardModule,
    MatSidenavModule,
    MatButtonModule,
    MatMenuModule,
    CommonModule,
    VideoCardComponent,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatIconModule,
    MatDialogModule,
  ],
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.css',
})
export class UserProfileComponent implements OnInit {
  user: User | null = null;
  // Initialise from localStorage immediately so there's no flash on load
  profileImage: string = (() => {
    try {
      const u = localStorage.getItem('user');
      if (u) {
        const parsed = JSON.parse(u);
        if (parsed.profileImage) return parsed.profileImage;
        const name = encodeURIComponent(parsed.name || 'User');
        return `https://ui-avatars.com/api/?name=${name}&background=random&color=fff&size=40`;
      }
    } catch {}
    return `https://ui-avatars.com/api/?name=User&background=random&color=fff&size=40`;
  })();
  userName: string = (() => {
    try {
      const u = localStorage.getItem('user');
      return u ? (JSON.parse(u).name || 'Username') : 'Username';
    } catch { return 'Username'; }
  })();
  userEmail: string = (() => {
    try {
      const u = localStorage.getItem('user');
      return u ? (JSON.parse(u).email || '') : '';
    } catch { return ''; }
  })();
  myVideos: any[] = [];
  likedVideos: any[] = [];
  dislikedVideos: any[] = [];
  showDashboard: boolean = false;
  showWelcome: boolean = true;
  showMyVideosSection: boolean = false;
  showLikedVideosSection: boolean = false;
  showDislikedVideosSection: boolean = false;
  private welcomeDismissed: boolean = false;
  displayedColumns: string[] = ['select', 'title', 'description', 'uploadedAt'];
  dataSource = new MatTableDataSource<any>([]);
  selection = new Set<string>();
  isMobile: boolean = false;
  private loginSubscription: Subscription | null = null;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private router: Router,
    private videoService: VideoService,
    private authService: AuthService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.checkScreenSize();
    this.loadUserData();
    this.loadMyVideos();
    this.loadLikedVideos();
    this.loadDislikedVideos();
  }

  ngOnDestroy() {
    if (this.loginSubscription) {
      this.loginSubscription.unsubscribe();
    }
  }

  private subscribeToLoginState() {
    this.loginSubscription = this.authService
      .getLoginState()
      .subscribe((isLoggedIn: boolean) => {
        this.loadUserData();
        // Use setTimeout to defer the change detection to the next cycle
        setTimeout(() => {
          // this.cdr.detectChanges(); // This line was removed as per the new_code
        });
      });
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.checkScreenSize();
  }

  private checkScreenSize() {
    this.isMobile = window.innerWidth <= 768;
  }

  ngAfterViewInit() {
    this.attachTableHelpers();
  }

  attachTableHelpers() {
    if (this.paginator && this.sort) {
      this.dataSource.paginator = this.paginator;
      this.dataSource.sort = this.sort;
    }
  }

  loadUserData(): void {
    try {
      const userData = localStorage.getItem('user');

      if (userData) {
        this.user = JSON.parse(userData);
        this.userName = this.user?.name || 'Username';
        this.userEmail = this.user?.email || '';
        if (this.user?.profileImage) {
          this.profileImage = this.user.profileImage;
        }
      } else {
        this.router.navigate(['/login']);
      }
    } catch (error) {
      console.error('UserProfile: Error loading user data:', error);
      this.router.navigate(['/login']);
    }
  }

  get totalLikes(): number {
    return this.myVideos.reduce((sum, v) => sum + (v.likes || 0), 0);
  }

  get totalViews(): number {
    return this.myVideos.reduce((sum, v) => sum + (v.views || 0), 0);
  }

  loadMyVideos(): void {
    if (!this.user) return;

    this.videoService.getMyVideos().subscribe({
      next: (videos: any[]) => {
        this.myVideos = videos;
        this.dataSource.data = videos;
        setTimeout(() => this.attachTableHelpers());
      },
      error: (err: any) => {
        console.error('Error loading user videos:', err);
      },
    });
  }

  loadLikedVideos(): void {
    if (!this.user) return;
    this.videoService.getLikedVideos().subscribe({
      next: (videos) => {
        this.likedVideos = videos;
      },
      error: (err) => {
        console.error('Error loading liked videos:', err);
      },
    });
  }

  loadDislikedVideos(): void {
    if (!this.user) return;
    this.videoService.getDislikedVideos().subscribe({
      next: (videos) => {
        this.dislikedVideos = videos;
      },
      error: (err) => {
        console.error('Error loading disliked videos:', err);
      },
    });
  }

  toggleDashboard() {
    this.showDashboard = true;
    this.showMyVideosSection = false;
    this.showLikedVideosSection = false;
    this.showDislikedVideosSection = false;
    this.dismissWelcome();

    setTimeout(() => this.attachTableHelpers());
  }

  showMyVideos() {
    this.showDashboard = false;
    this.showMyVideosSection = true;
    this.showLikedVideosSection = false;
    this.showDislikedVideosSection = false;
    this.dismissWelcome();
  }

  showLikedVideos() {
    this.showDashboard = false;
    this.showMyVideosSection = false;
    this.showLikedVideosSection = true;
    this.showDislikedVideosSection = false;
    this.dismissWelcome();
  }

  showDislikedVideos() {
    this.showDashboard = false;
    this.showMyVideosSection = false;
    this.showLikedVideosSection = false;
    this.showDislikedVideosSection = true;
    this.dismissWelcome();
  }

  // Method to handle accordion panel opening
  onPanelOpened(section: string) {
    // Close all other sections
    this.showDashboard = section === 'dashboard';
    this.showMyVideosSection = section === 'myVideos';
    this.showLikedVideosSection = section === 'likedVideos';
    this.showDislikedVideosSection = section === 'dislikedVideos';
    this.dismissWelcome();

    if (section === 'myVideos' || section === 'dashboard') {
      setTimeout(() => this.attachTableHelpers());
    }
  }

  private dismissWelcome() {
    if (!this.welcomeDismissed) {
      this.showWelcome = false;
      this.welcomeDismissed = true;
    }
  }

  isAllSelected() {
    return this.selection.size === this.dataSource.data.length;
  }

  masterToggle() {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.dataSource.data.forEach((row) => this.selection.add(row._id));
    }
  }

  toggleSelection(id: string) {
    if (this.selection.has(id)) {
      this.selection.delete(id);
    } else {
      this.selection.add(id);
    }
  }

  deleteSelected() {
    const ids = Array.from(this.selection);
    if (ids.length === 0) return;
    if (
      !confirm(
        'Are you sure you want to delete the selected videos? This action cannot be undone.',
      )
    )
      return;

    const userId = this.user?.userId;
    if (!userId) return;

    const deleteRequests = ids.map((id) =>
      this.videoService.deleteVideo(id, userId).pipe(
        catchError((err) => {
          console.error(`Failed to delete video ${id}:`, err);
          return of({ error: true, id });
        }),
      ),
    );

    forkJoin(deleteRequests).subscribe({
      next: () => {
        this.selection.clear();
        this.loadMyVideos();
      },
      error: (err) => {
        console.error('Unexpected error during deletion:', err);
      },
    });
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.onerror = null; // prevent infinite loop
    const name = encodeURIComponent(this.userName || 'User');
    img.src = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff&size=40`;
  }

  openUploadPage(): void {
    this.dialog.open(UploadVideoComponent, {
      width: '560px',
      maxWidth: '96vw',
      panelClass: 'ss-upload-dialog',
      autoFocus: true,
      restoreFocus: true,
    });
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
