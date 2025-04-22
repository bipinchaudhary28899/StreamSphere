import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from "./components/header/header.component";
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { VideoSectionComponent } from './components/video-section/video-section.component';
import { CategorySliderComponent } from "./components/category-slider/category-slider.component";

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet ,HeaderComponent, SidebarComponent, VideoSectionComponent, CategorySliderComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
 searchText:string ='';
 selectedCategory: string='All';
 handleSearch(term:string) {
  this.searchText = term.toLowerCase();
  }
  handleCategory(category:string) {
    this.selectedCategory=category;
  }
 }