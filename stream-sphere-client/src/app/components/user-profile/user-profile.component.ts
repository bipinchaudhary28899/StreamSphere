import { Component, OnInit, ViewChild } from '@angular/core';
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
  imports: [MatCardModule, MatSidenavModule, MatButtonModule, MatMenuModule, CommonModule, VideoCardComponent, MatTableModule, MatPaginatorModule, MatSortModule, MatCheckboxModule],
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

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private router: Router,
    private videoService: VideoService
  ) {}

  ngOnInit(): void {
    this.loadUserData();
    this.loadMyVideos();
    this.loadLikedVideos();
    this.loadDislikedVideos();
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
    if (!this.user) return;
    this.videoService.getAllVideos().subscribe({
      next: (videos) => {
        this.myVideos = videos.filter((video: any) => video.user_id === this.user?.userId);
        this.dataSource.data = this.myVideos;
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
    this.showDashboard = !this.showDashboard;
    this.showMyVideosSection = true;
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
    ids.forEach(id => {
      this.videoService.deleteVideo(id, this.user!.userId).subscribe({
        next: () => {
          this.myVideos = this.myVideos.filter(v => v._id !== id);
          this.dataSource.data = this.myVideos;
          this.selection.delete(id);
        },
        error: (err) => {
          console.error('Error deleting video:', err);
        }
      });
    });
  }

  onImageError(event: any): void {
    event.target.src = 'assets/thumbs/taarak.jpg';
  }

  openUploadPage(): void {
    this.router.navigate(['/upload']);
  }

  logout(): void {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    this.router.navigate(['/login']);
  }
}
