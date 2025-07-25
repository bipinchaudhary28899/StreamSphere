import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { HeaderComponent } from "./components/header/header.component";
import { SidebarComponent } from './components/sidebar/sidebar.component';

import { VideoService } from './services/video.service';
import { filter, Subscription } from 'rxjs';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet ,HeaderComponent, SidebarComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  public title = 'stream-sphere-client';
  showCategorySlider: boolean = true;
  isHomePage: boolean = true;
  isLoggedIn: boolean = false;
  public currentYear: number = new Date().getFullYear();
  private loginSubscription: Subscription | null = null;

  constructor(
    private router: Router,
    private videoService: VideoService,
    private authService: AuthService
  ) {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        const url = event.url;
        this.showCategorySlider = !url.includes('/video/');
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

  searchText:string ='';
  selectedCategory: string='All';
  
  handleSearch(term:string) {
   console.log('App component received search term:', term);
   this.searchText = term.toLowerCase();
   this.videoService.setSearchTerm(term.toLowerCase());
  }
  
  handleCategory(category:string) {
     console.log('App component received category:', category);
     this.selectedCategory = category;
     this.videoService.setCategory(category);
  }
}