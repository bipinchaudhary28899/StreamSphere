import { Component, Output, EventEmitter, HostListener, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
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
import { AuthService } from '../../services/auth.service';
import { Subscription } from 'rxjs';

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
export class HeaderComponent implements OnInit, OnDestroy {
  constructor(
    private router: Router,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ){ 
  }
  
  isLoggedIn: boolean = false;
  user: User | null = null;
  profileImage: string = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNlNWU3ZWYiLz4KPHBhdGggZD0iTTIwIDEwQzIyLjA5IDEwIDI0IDEyLjA5IDI0IDE0QzI0IDE1LjkxIDIyLjA5IDE4IDIwIDE4QzE3LjkxIDE4IDE2IDE1LjkxIDE2IDE0QzE2IDEyLjA5IDE3LjkxIDEwIDIwIDEwWk0yMCAyMEMyMi4wOSAyMCAyNCAyMi4wOSAyNCAyNEMyNCAyNS45MSAyMi4wOSAyOCAyMCAyOEMxNy45MSAyOCAxNiAyNS45MSAxNiAyNEMxNiAyMi4wOSAxNy45MSAyMCAyMCAyMFoiIGZpbGw9IiM5Y2EzYWYiLz4KPC9zdmc+';
  private loginSubscription: Subscription | null = null;
  
  @Output() search = new EventEmitter<string>();

  ngOnInit() {
    this.loadUserData();
    this.subscribeToLoginState();
  }

  ngOnDestroy() {
    if (this.loginSubscription) {
      this.loginSubscription.unsubscribe();
    }
  }

  private subscribeToLoginState() {
    this.loginSubscription = this.authService.getLoginState().subscribe(
      (isLoggedIn: boolean) => {
        console.log('Header: Login state changed to:', isLoggedIn);
        this.isLoggedIn = isLoggedIn;
        this.loadUserData();
        // Use setTimeout to defer the change detection to the next cycle
        setTimeout(() => {
          this.cdr.detectChanges();
        });
      }
    );
  }

  loadUserData(): void {
    try {
      const userData = localStorage.getItem('user');
      console.log('Header: Loading user data from localStorage:', userData);
      
      if (userData) {
        this.user = JSON.parse(userData);
        this.isLoggedIn = true;
        if (this.user?.profileImage) {
          this.profileImage = this.user.profileImage;
        } else {
          this.profileImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNlNWU3ZWYiLz4KPHBhdGggZD0iTTIwIDEwQzIyLjA5IDEwIDI0IDEyLjA5IDI0IDE0QzI0IDE1LjkxIDIyLjA5IDE4IDIwIDE4QzE3LjkxIDE4IDE2IDE1LjkxIDE2IDE0QzE2IDEyLjA5IDE3LjkxIDEwIDIwIDEwWk0yMCAyMEMyMi4wOSAyMCAyNCAyMi4wOSAyNCAyNEMyNCAyNS45MSAyMi4wOSAyOCAyMCAyOEMxNy45MSAyOCAxNiAyNS45MSAxNiAyNEMxNiAyMi4wOSAxNy45MSAyMCAyMCAyMFoiIGZpbGw9IiM5Y2EzYWYiLz4KPC9zdmc+';
        }
        console.log('Header: User is logged in:', this.user);
      } else {
        this.isLoggedIn = false;
        this.user = null;
        this.profileImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNlNWU3ZWYiLz4KPHBhdGggZD0iTTIwIDEwQzIyLjA5IDEwIDI0IDEyLjA5IDI0IDE0QzI0IDE1LjkxIDIyLjA5IDE4IDIwIDE4QzE3LjkxIDE4IDE2IDE1LjkxIDE2IDE0QzE2IDEyLjA5IDE3LjkxIDEwIDIwIDEwWk0yMCAyMEMyMi4wOSAyMCAyNCAyMi4wOSAyNCAyNEMyNCAyNS45MSAyMi4wOSAyOCAyMCAyOEMxNy45MSAyOCAxNiAyNS45MSAxNiAyNEMxNiAyMi4wOSAxNy45MSAyMCAyMCAyMFoiIGZpbGw9IiM5Y2EzYWYiLz4KPC9zdmc+';
        console.log('Header: User is not logged in');
      }
    } catch (error) {
      this.isLoggedIn = false;
      this.user = null;
      this.profileImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNlNWU3ZWYiLz4KPHBhdGggZD0iTTIwIDEwQzIyLjA5IDEwIDI0IDEyLjA5IDI0IDE0QzI0IDE1LjkxIDIyLjA5IDE4IDIwIDE4QzE3LjkxIDE4IDE2IDE1LjkxIDE2IDE0QzE2IDEyLjA5IDE3LjkxIDEwIDIwIDEwWk0yMCAyMEMyMi4wOSAyMCAyNCAyMi4wOSAyNCAyNEMyNCAyNS45MSAyMi4wOSAyOCAyMCAyOEMxNy45MSAyOCAxNiAyNS45MSAxNiAyNEMxNiAyMi4wOSAxNy45MSAyMCAyMCAyMFoiIGZpbGw9IiM5Y2EzYWYiLz4KPC9zdmc+';
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
    setTimeout(() => {
      this.authService.updateLoginState(false);
    });
    this.router.navigate(['/login']);
  }

  onImageError(event: any): void {
    event.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiNlNWU3ZWYiLz4KPHBhdGggZD0iTTIwIDEwQzIyLjA5IDEwIDI0IDEyLjA5IDI0IDE0QzI0IDE1LjkxIDIyLjA5IDE4IDIwIDE4QzE3LjkxIDE4IDE2IDE1LjkxIDE2IDE0QzE2IDEyLjA5IDE3LjkxIDEwIDIwIDEwWk0yMCAyMEMyMi4wOSAyMCAyNCAyMi4wOSAyNCAyNEMyNCAyNS45MSAyMi4wOSAyOCAyMCAyOEMxNy45MSAyOCAxNiAyNS45MSAxNiAyNEMxNiAyMi4wOSAxNy45MSAyMCAyMCAyMFoiIGZpbGw9IiM5Y2EzYWYiLz4KPC9zdmc+';
  }
}