import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { HeaderComponent } from "./components/header/header.component";
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { CategorySliderComponent } from "./components/category-slider/category-slider.component";
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

  constructor(private router: Router) {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        const url = event.url;
        this.showCategorySlider = !url.includes('/video/');
      });
  }
 searchText:string ='';
 selectedCategory: string='All';
 handleSearch(term:string) {
  this.searchText = term.toLowerCase();
  }
  handleCategory(category:string) {
    this.selectedCategory=category;
  }
 }