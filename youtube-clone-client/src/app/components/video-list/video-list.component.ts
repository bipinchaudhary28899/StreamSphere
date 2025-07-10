// video-list.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { VideoService } from '../../services/video.service';
import { VideoCardComponent } from "../video-card/video-card.component";
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-video-list',
  templateUrl: './video-list.component.html',
  styleUrls: ['./video-list.component.scss'],
  standalone: true,
  imports: [VideoCardComponent, MatIcon, CommonModule, MatProgressSpinnerModule]
})
export class VideoListComponent implements OnInit, OnDestroy {
  allVideos: any[] = [];
  myVideos:any[]=[];
  filteredVideos: any[] = [];
  isLoading = true;
  error: string | null = null;
  private searchSubscription?: Subscription;

  constructor(private videoService: VideoService) { }

  ngOnInit(): void {
    this.loadVideos();
    this.searchSubscription = this.videoService.search$.subscribe(searchTerm => {
      this.applyFilter(searchTerm);
    });
  }

  ngOnDestroy(): void {
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
    }
  }

  loadVideos(): void {
    this.videoService.getAllVideos().subscribe({
      next: (videos) => {
        this.allVideos = videos;
        console.log("all video are : ",this.allVideos);
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
  loadUserVideos() {
    const userId = JSON.parse(localStorage.getItem('user')!).userId;
    this.myVideos = this.allVideos.filter(video => video.userId === userId);
  }
  // Optional: Add filtering logic
  applyFilter(filterTerm: string): void {
    if (!filterTerm || filterTerm.trim() === '') {
      this.filteredVideos = [...this.allVideos];
      return;
    }
    
    const searchTerm = filterTerm.toLowerCase().trim();
    console.log('Searching for:', searchTerm);
    
    this.filteredVideos = this.allVideos.filter(video => {
      const title = video.title?.toLowerCase() || '';
      const description = video.description?.toLowerCase() || '';
      
      // Check for word boundaries or exact matches
      const titleMatch = title.includes(searchTerm) && 
        (title.split(' ').some((word: string) => word.startsWith(searchTerm) || word.includes(searchTerm)));
      const descriptionMatch = description.includes(searchTerm) && 
        (description.split(' ').some((word: string) => word.startsWith(searchTerm) || word.includes(searchTerm)));
      
      if (titleMatch || descriptionMatch) {
        console.log('Match found:', video.title, 'for search term:', searchTerm);
      }
      
      return titleMatch || descriptionMatch;
    });
    
    console.log(`Filtered ${this.filteredVideos.length} videos for term: "${searchTerm}"`);
  }
}