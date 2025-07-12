import { Component, OnInit, ViewChild, HostListener } from '@angular/core';
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

interface User {
  userId: string;
  name: string;
  email: string;
  profileImage: string;
  isVerified: boolean;
  role: string;
}

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
    MatIconModule
  ],
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.css'
})
export class UserProfileComponent implements OnInit {
  user: User | null = null;
  profileImage: string = 'assets/thumbs/taarak.jpg';
  userName: string = 'Username';
  userEmail: string = '';
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

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private router: Router,
    private videoService: VideoService
  ) {}

  ngOnInit(): void {
    this.checkScreenSize();
    this.loadUserData();
    this.loadMyVideos();
    this.loadLikedVideos();
    this.loadDislikedVideos();
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.checkScreenSize();
  }

  private checkScreenSize() {
    this.isMobile = window.innerWidth <= 768;
    console.log('Screen width:', window.innerWidth, 'Is mobile:', this.isMobile);
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
        console.log('User data loaded:', this.user);
      } else {
        console.log('No user data found in localStorage');
        this.router.navigate(['/login']);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      this.router.navigate(['/login']);
    }
  }

  loadMyVideos(): void {
    if (!this.user) {
      console.log('No user data available for loading videos');
      return;
    }
    
    console.log('Loading videos for user:', this.user);
    console.log('User ID:', this.user.userId);
    
    this.videoService.getAllVideos().subscribe({
      next: (videos) => {
        console.log('All videos received:', videos);
        console.log('Filtering videos for user_id ===', this.user?.userId);
        
        this.myVideos = videos.filter((video: any) => {
          const matches = video.user_id === this.user?.userId;
          console.log(`Video ${video.title}: user_id=${video.user_id}, matches=${matches}`);
          return matches;
        });
        
        this.dataSource.data = this.myVideos;
        console.log('My videos loaded:', this.myVideos);
        console.log('Data source updated with', this.dataSource.data.length, 'videos');
        setTimeout(() => this.attachTableHelpers());
      },
      error: (err) => {
        console.error('Error loading user videos:', err);
      }
    });
  }

  loadLikedVideos(): void {
    if (!this.user) return;
    this.videoService.getLikedVideos().subscribe({
      next: (videos) => {
        this.likedVideos = videos;
        console.log('Liked videos loaded:', this.likedVideos);
      },
      error: (err) => {
        console.error('Error loading liked videos:', err);
      }
    });
  }

  loadDislikedVideos(): void {
    if (!this.user) return;
    this.videoService.getDislikedVideos().subscribe({
      next: (videos) => {
        this.dislikedVideos = videos;
        console.log('Disliked videos loaded:', this.dislikedVideos);
      },
      error: (err) => {
        console.error('Error loading disliked videos:', err);
      }
    });
  }

  toggleDashboard() {
    console.log('Dashboard button clicked');
    console.log('Current showDashboard state:', this.showDashboard);
    console.log('Current data source length:', this.dataSource.data.length);
    console.log('Current myVideos length:', this.myVideos.length);
    
    this.showDashboard = !this.showDashboard;
    this.showMyVideosSection = false;
    this.showLikedVideosSection = false;
    this.showDislikedVideosSection = false;
    this.dismissWelcome();
    
    console.log('New showDashboard state:', this.showDashboard);
    console.log('All sections hidden except dashboard');
    
    setTimeout(() => this.attachTableHelpers());
  }

  showMyVideos() {
    this.showDashboard = false;
    this.showMyVideosSection = true;
    this.showLikedVideosSection = false;
    this.showDislikedVideosSection = false;
    this.dismissWelcome();
    console.log('Showing my videos section');
  }

  showLikedVideos() {
    this.showDashboard = false;
    this.showMyVideosSection = false;
    this.showLikedVideosSection = true;
    this.showDislikedVideosSection = false;
    this.dismissWelcome();
    console.log('Showing liked videos section');
  }

  showDislikedVideos() {
    this.showDashboard = false;
    this.showMyVideosSection = false;
    this.showLikedVideosSection = false;
    this.showDislikedVideosSection = true;
    this.dismissWelcome();
    console.log('Showing disliked videos section');
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
      this.dataSource.data.forEach(row => this.selection.add(row._id));
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
    if (!confirm('Are you sure you want to delete the selected videos? This action cannot be undone.')) return;
    
    // Implementation for deleting selected videos
    console.log('Deleting videos:', ids);
  }

  onImageError(event: any): void {
    event.target.src = 'assets/thumbs/taarak.jpg';
  }

  openUploadPage(): void {
    this.router.navigate(['/upload']);
  }

  logout() {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    this.router.navigate(['/login']);
  }
}
