import { CommonModule } from '@angular/common';
import { Component,Input } from '@angular/core';
import { VideoCardComponent } from '../video-card/video-card.component';
import { VIDEO_DATA } from '../../data/video-data';

@Component({
  selector: 'app-video-section',
  standalone: true,
  imports: [CommonModule, VideoCardComponent],
  templateUrl: './video-section.component.html',
  styleUrl: './video-section.component.css'
})
export class VideoSectionComponent {
videos = VIDEO_DATA;
@Input() searchText ='';
@Input() selectedCategory ='All';
get filteredVideos() {
  return this.videos.filter(v=> v.title.toLowerCase().includes(this.searchText.toLowerCase()) && (this.selectedCategory === 'All' || v.category ===this.selectedCategory));
}
}
