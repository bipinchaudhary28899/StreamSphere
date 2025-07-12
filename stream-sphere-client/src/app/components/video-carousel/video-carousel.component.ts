import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VideoService } from '../../services/video.service';
import { VideoCardComponent } from '../video-card/video-card.component';

@Component({
  selector: 'app-video-carousel',
  standalone: true,
  imports: [CommonModule, VideoCardComponent],
  templateUrl: './video-carousel.component.html',
  styleUrls: ['./video-carousel.component.css']
})
export class VideoCarouselComponent implements OnInit, OnDestroy {
  topVideos: any[] = [];
  currentIndex = 0;
  private interval: any;
  isAnimating = false;
  animationDirection = '';

  constructor(private videoService: VideoService) {}

  ngOnInit(): void {
    this.loadTopVideos();
    this.startAutoRotation();
  }

  ngOnDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  loadTopVideos(): void {
    this.videoService.getTopLikedVideos().subscribe({
      next: (videos) => {
        this.topVideos = videos;
      },
      error: (error) => {
        console.error('Error loading top videos:', error);
      }
    });
  }

  startAutoRotation(): void {
    this.interval = setInterval(() => {
      this.nextSlide();
    }, 3000);
  }

  nextSlide(): void {
    if (this.isAnimating || this.topVideos.length <= 1) return;
    
    this.isAnimating = true;
    this.animationDirection = 'next';
    
    setTimeout(() => {
      this.currentIndex = (this.currentIndex + 1) % this.topVideos.length;
      this.isAnimating = false;
      this.animationDirection = '';
    }, 600);
  }

  prevSlide(): void {
    if (this.isAnimating || this.topVideos.length <= 1) return;
    
    this.isAnimating = true;
    this.animationDirection = 'prev';
    
    setTimeout(() => {
      this.currentIndex = (this.currentIndex - 1 + this.topVideos.length) % this.topVideos.length;
      this.isAnimating = false;
      this.animationDirection = '';
    }, 600);
  }

  goToSlide(index: number): void {
    if (this.isAnimating || index === this.currentIndex || this.topVideos.length <= 1) return;
    
    this.isAnimating = true;
    this.animationDirection = index > this.currentIndex ? 'next' : 'prev';
    
    setTimeout(() => {
      this.currentIndex = index;
      this.isAnimating = false;
      this.animationDirection = '';
    }, 600);
  }

  get currentVideo(): any {
    return this.topVideos[this.currentIndex] || null;
  }

  get prevVideo(): any {
    if (this.topVideos.length < 2) return null;
    return this.topVideos[(this.currentIndex - 1 + this.topVideos.length) % this.topVideos.length];
  }

  get nextVideo(): any {
    if (this.topVideos.length < 2) return null;
    return this.topVideos[(this.currentIndex + 1) % this.topVideos.length];
  }

  getPrevCardClass(): string {
    let classes = 'carousel-card prev';
    if (this.isAnimating && this.animationDirection === 'prev') {
      classes += ' sliding-left';
    }
    return classes;
  }

  getActiveCardClass(): string {
    let classes = 'carousel-card active';
    if (this.isAnimating) {
      classes += this.animationDirection === 'next' ? ' sliding-left' : ' sliding-right';
    }
    return classes;
  }

  getNextCardClass(): string {
    let classes = 'carousel-card next';
    if (this.isAnimating && this.animationDirection === 'next') {
      classes += ' sliding-right';
    }
    return classes;
  }
} 