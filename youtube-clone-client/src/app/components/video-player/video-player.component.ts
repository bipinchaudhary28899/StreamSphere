import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { VIDEO_DATA } from '../../data/video-data';

@Component({
  selector: 'app-video-player',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './video-player.component.html',
  styleUrls: ['./video-player.component.css']
})
export class VideoPlayerComponent {
  video: any;

  constructor(private route: ActivatedRoute) {
    const videoId = this.route.snapshot.paramMap.get('id');
    this.video = VIDEO_DATA.find(v => v.id === videoId);
  }
}