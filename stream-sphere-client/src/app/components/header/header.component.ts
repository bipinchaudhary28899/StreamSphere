import { Component, Output, EventEmitter, HostListener } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { UserLoginComponent } from "../user-login/user-login.component";
import { Router } from '@angular/router';

interface User {
  userId: string;
  name: string;
  email: string;
  profileImage: string;
  isVerified: boolean;
  role: string;
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, MatToolbarModule, MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule, MatMenuModule, MatDividerModule, UserLoginComponent],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css']
})
export class HeaderComponent {
  constructor(
    private router: Router,
  ){ 
  }
  
  isLoggedIn: boolean = false;
  isMobile: boolean = false;
  user: User | null = null;
  profileImage: string = 'assets/thumbs/taarak.jpg';
  
  @Output() search = new EventEmitter<string>();

  ngOnInit() {
    this.checkScreenSize();
    this.loadUserData();
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.checkScreenSize();
    this.loadUserData();
  }

  private checkScreenSize() {
    this.isMobile = window.innerWidth <= 768;
  }

  loadUserData(): void {
    try {
      const userData = localStorage.getItem('user');
      if (userData) {
        this.user = JSON.parse(userData);
        this.isLoggedIn = true;
        if (this.user?.profileImage) {
          this.profileImage = this.user.profileImage;
        } else {
          this.profileImage = 'assets/thumbs/taarak.jpg';
        }
      } else {
        this.isLoggedIn = false;
        this.user = null;
        this.profileImage = 'assets/thumbs/taarak.jpg';
      }
    } catch (error) {
      this.isLoggedIn = false;
      this.user = null;
      this.profileImage = 'assets/thumbs/taarak.jpg';
      console.error('Error loading user data:', error);
    }
  }

  onSearchChange(event: any) {
    this.search.emit(event.target.value);
  }
  
  redirectToHome() {
    this.router.navigate(['/home']);
  }

  navigateToProfile() {
    this.router.navigate(['/user-profile']);
  }

  navigateToUpload() {
    this.router.navigate(['/upload']);
  }

  logout() {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    this.loadUserData();
    this.router.navigate(['/login']);
  }

  onImageError(event: any): void {
    event.target.src = 'assets/thumbs/taarak.jpg';
  }
}