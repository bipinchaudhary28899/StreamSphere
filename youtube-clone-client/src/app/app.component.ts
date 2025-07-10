import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { HeaderComponent } from "./components/header/header.component";
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { CategorySliderComponent } from "./components/category-slider/category-slider.component";
import { VideoService } from './services/video.service';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet ,HeaderComponent, SidebarComponent, CategorySliderComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  showCategorySlider: boolean = true;
  isHomePage: boolean = true;

  constructor(
    private router: Router,
    private videoService: VideoService
  ) {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        const url = event.url;
        this.showCategorySlider = !url.includes('/video/');
        this.isHomePage = url.includes('/home') || url === '/';
      });
  }
  searchText:string ='';
  selectedCategory: string='All';
  handleSearch(term:string) {
   console.log('App component received search term:', term);
   this.searchText = term.toLowerCase();
   this.videoService.setSearchTerm(term.toLowerCase());
   }
   handleCategory(category:string) {
     this.selectedCategory=category;
   }
  }