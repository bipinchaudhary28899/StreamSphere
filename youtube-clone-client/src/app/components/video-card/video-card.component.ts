import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-video-card',
  standalone: true,
  imports: [CommonModule,MatCardModule,RouterModule],
  templateUrl: './video-card.component.html',
  styleUrl: './video-card.component.css'
})
export class VideoCardComponent {
@Input() video: any;
}
