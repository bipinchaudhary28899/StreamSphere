import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet, RouterModule } from '@angular/router';
import { HeaderComponent } from "./components/header/header.component";
import { MatIconModule } from '@angular/material/icon';

import { filter, Subscription } from 'rxjs';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterModule, HeaderComponent, MatIconModule],
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