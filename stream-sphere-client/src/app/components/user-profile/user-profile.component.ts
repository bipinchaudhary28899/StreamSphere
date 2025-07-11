import { Component, OnInit } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';

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
  imports: [MatCardModule, MatSidenavModule, MatButtonModule, MatMenuModule, CommonModule],
  templateUrl: './user-profile.component.html',
  styleUrl: './user-profile.component.css'
})
export class UserProfileComponent implements OnInit {
  user: User | null = null;
  profileImage: string = 'assets/thumbs/taarak.jpg';
  userName: string = 'Username';
  userEmail: string = '';

  constructor(
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadUserData();
  }

  loadUserData(): void {
    try {
      const userData = localStorage.getItem('user');
      if (userData) {
        this.user = JSON.parse(userData);
        this.userName = this.user?.name || 'Username';
        this.userEmail = this.user?.email || '';
        
        // Use Google profile image if available, otherwise use placeholder
        if (this.user?.profileImage) {
          this.profileImage = this.user.profileImage;
        }
        
        console.log('User data loaded:', this.user);
      } else {
        console.log('No user data found in localStorage');
        // Redirect to login if no user data
        this.router.navigate(['/login']);
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      this.router.navigate(['/login']);
    }
  }

  onImageError(event: any): void {
    console.log('Profile image failed to load, using placeholder');
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
