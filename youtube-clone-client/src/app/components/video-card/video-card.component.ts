// video-card.component.ts
import { Component, Input, OnInit } from '@angular/core';
import { MatCard, MatCardContent } from '@angular/material/card';
import { DomSanitizer } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-video-card',
  templateUrl: './video-card.component.html',
  styleUrls: ['./video-card.component.scss'],
  standalone: true,
  imports: [MatCardContent, MatCard, CommonModule]
})
export class VideoCardComponent implements OnInit {
  @Input() video: any;
  safeUrl: any;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit() {
    // Test the URL directly in browser console
    console.log('Video URL:', this.video.url);
    
    // Create safe URL for Angular
    this.safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.video.S3_url);
  }
  get safeVideoUrl(): string {
    return this.video?.S3_url || '';
  }
}