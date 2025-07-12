// video-card.component.ts
import { Component, Input, OnInit, Output, EventEmitter } from '@angular/core';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector: 'app-video-card',
  templateUrl: './video-card.component.html',
  styleUrls: ['./video-card.component.scss'],
  standalone: true,
  imports: [MatCardContent, MatCard, CommonModule, MatButtonModule, MatIconModule]
})
export class VideoCardComponent implements OnInit {
  @Input() video: any;
  @Input() flipEnabled: boolean = true;
  @Input() faded: boolean = false;
  @Output() videoDeleted = new EventEmitter<string>();
  safeUrl: any;
  currentUserId: string | null = null;
  isOwner: boolean = false;
  flip = false;

  constructor(
    private sanitizer: DomSanitizer,
    private router: Router
  ) {}

  ngOnInit() {
    // Check if video data exists
    if (!this.video) {
      console.error('No video data provided to video card component');
      return;
    }
    
    // Test the URL directly in browser console
    console.log('Video URL:', this.video.S3_url);
    
    // Create safe URL for Angular
    this.safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.video.S3_url);
    
    // Check if current user is the owner of this video
    const userData = localStorage.getItem('user');
    if (userData) {
      const user = JSON.parse(userData);
      this.currentUserId = user.userId;
      this.isOwner = this.video.user_id === user.userId;
    }
  }

  get safeVideoUrl(): string {
    return this.video?.S3_url || '';
  }

  onVideoClick() {
    if (this.video && this.video._id) {
      this.router.navigate(['/video', this.video._id]);
    }
  }

  onDeleteClick(event: Event) {
    event.stopPropagation(); // Prevent video click
    if (confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
      this.deleteVideo();
    }
  }

  onFlipClick(event: Event) {
    event.stopPropagation();
    this.flip = !this.flip;
  }

  deleteVideo() {
    if (!this.currentUserId || !this.video._id) return;
    
    // Note: You'll need to import VideoService if you want to keep delete functionality
    // For now, just emit the event and let parent handle it
    this.videoDeleted.emit(this.video._id);
  }
}