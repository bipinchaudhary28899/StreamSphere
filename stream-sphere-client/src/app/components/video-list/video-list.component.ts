// video-list.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { VideoService } from '../../services/video.service';
import { VideoCardComponent } from "../video-card/video-card.component";
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription } from 'rxjs';
import { CategorySliderComponent } from "../category-slider/category-slider.component";
import { HeroCarouselComponent } from "../hero-carousel/hero-carousel.component";

@Component({
  selector: 'app-video-list',
  templateUrl: './video-list.component.html',
  styleUrls: ['./video-list.component.scss'],
  standalone: true,
  imports: [VideoCardComponent, MatIcon, CommonModule, MatProgressSpinnerModule, CategorySliderComponent, HeroCarouselComponent]
})
export class VideoListComponent implements OnInit, OnDestroy {
  allVideos: any[] = [];
  myVideos:any[]=[];
  filteredVideos: any[] = [];
  isLoading = true;
  error: string | null = null;
  private searchSubscription?: Subscription;
  private categorySubscription?: Subscription;
  currentCategory: string = 'All';

  constructor(private videoService: VideoService) { }

  ngOnInit(): void {
    this.loadVideos();
    this.searchSubscription = this.videoService.search$.subscribe(searchTerm => {
      this.applyFilter(searchTerm);
    });
    this.categorySubscription = this.videoService.category$.subscribe(category => {
      this.currentCategory = category;
      this.loadVideosByCategory(category);
    });
  }

  ngOnDestroy(): void {
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
    }
    if (this.categorySubscription) {
      this.categorySubscription.unsubscribe();
    }
  }

  loadVideos(): void {
    this.videoService.getAllVideos().subscribe({
      next: (videos) => {
        this.allVideos = videos;
       
        this.filteredVideos = [...videos]; // Initially show all videos
        this.isLoading = false;
        
      },
      error: (err) => {
        this.error = 'Failed to load videos. Please try again later.';
        this.isLoading = false;
        console.error('Error loading videos:', err);
      }
    });
  }

  loadVideosByCategory(category: string): void {
    this.isLoading = true;
    this.error = null;
    
    this.videoService.getVideosByCategory(category).subscribe({
      next: (videos) => {
        this.allVideos = videos;
        
        this.filteredVideos = [...videos];
        this.isLoading = false;
      },
      error: (err) => {
        this.error = `Failed to load videos for category "${category}". Please try again later.`;
        this.isLoading = false;
        console.error('Error loading videos by category:', err);
      }
    });
  }

  onVideoDeleted(videoId: string): void {
    // Remove the deleted video from all arrays
    this.allVideos = this.allVideos.filter(video => video._id !== videoId);
    this.filteredVideos = this.filteredVideos.filter(video => video._id !== videoId);
    this.myVideos = this.myVideos.filter(video => video._id !== videoId);
  }

  loadUserVideos() {
    const userId = JSON.parse(localStorage.getItem('user')!).userId;
    this.myVideos = this.allVideos.filter(video => video.userId === userId);
  }

  handleCategory(category: string): void {
    this.currentCategory = category;
    this.loadVideosByCategory(category);
  }

  // Optional: Add filtering logic
  applyFilter(filterTerm: string): void {
    if (!filterTerm || filterTerm.trim() === '') {
      this.filteredVideos = [...this.allVideos];
      return;
    }
    
    const searchTerm = filterTerm.toLowerCase().trim();
    
    
    this.filteredVideos = this.allVideos.filter(video => {
      const title = video.title?.toLowerCase() || '';
      const description = video.description?.toLowerCase() || '';
      
      // Check for word boundaries or exact matches
      const titleMatch = title.includes(searchTerm) && 
        (title.split(' ').some((word: string) => word.startsWith(searchTerm) || word.includes(searchTerm)));
      const descriptionMatch = description.includes(searchTerm) && 
        (description.split(' ').some((word: string) => word.startsWith(searchTerm) || word.includes(searchTerm)));
      
     
      
      return titleMatch || descriptionMatch;
    });
    
    
  }
}