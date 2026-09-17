import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet, RouterModule } from '@angular/router';
import { HeaderComponent } from "./components/header/header.component";
import { MatIconModule } from '@angular/material/icon';
import { UploadIndicatorComponent } from './components/upload-indicator/upload-indicator.component';

import { filter, Subscription } from 'rxjs';
import { AuthService } from './services/auth.service';
import { UploadManagerService } from './services/upload-manager.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterModule, HeaderComponent, MatIconModule, UploadIndicatorComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  public title = 'stream-sphere-client';
  isHomePage: boolean = true;
  isLoggedIn: boolean = false;
  private loginSubscription: Subscription | null = null;

  constructor(
    private router: Router,
    private authService: AuthService,
    public uploads: UploadManagerService,
  ) {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        const url = event.url;
        this.isHomePage = url.includes('/home') || url === '/';
        this.checkLoginState();
      });
    this.checkLoginState();
    this.subscribeToLoginState();
  }

  subscribeToLoginState() {
    this.loginSubscription = this.authService.getLoginState().subscribe((isLoggedIn: boolean) => {
      this.isLoggedIn = isLoggedIn;
    });
  }

  ngOnDestroy() {
    if (this.loginSubscription) {
      this.loginSubscription.unsubscribe();
    }
  }

  /** The Upload tab doubles as the upload's status while one is running. */
  get uploadNavLabel(): string {
    const active = this.uploads.active;
    if (active?.phase === 'uploading') return `${active.progress}%`;
    if (active?.phase === 'saving') return 'Finishing';
    if (this.uploads.hasFailed) return 'Failed';
    return 'Upload';
  }

  get uploadNavAriaLabel(): string {
    const active = this.uploads.active;
    const waiting = this.uploads.waiting.length;
    if (active?.phase === 'uploading') {
      const queue = waiting > 0 ? `, ${waiting} more waiting` : '';
      return `Uploading, ${active.progress}% done${queue}. View uploads`;
    }
    if (active?.phase === 'saving') return 'Finishing upload. View uploads';
    if (this.uploads.hasFailed) return 'Upload failed. View uploads';
    const processing = this.uploads.processingCount;
    if (processing > 0) return `Upload a video. ${processing} ${processing === 1 ? 'video' : 'videos'} processing`;
    return 'Upload a video';
  }

  checkLoginState() {
    const storedUser = localStorage.getItem('user');
    if (storedUser && storedUser !== 'undefined') {
      try {
        const parsedUser = JSON.parse(storedUser);
        this.isLoggedIn = !!parsedUser?.userId;
      } catch (e) {
        this.isLoggedIn = false;
      }
    } else {
      this.isLoggedIn = false;
    }
  }

}