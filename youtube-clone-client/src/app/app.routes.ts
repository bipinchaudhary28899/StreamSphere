import { Routes } from '@angular/router';
import { AppComponent } from './app.component';
import { VideoPlayerComponent } from './components/video-player/video-player.component';
import { AuthGuard } from './auth.guard';
import { VideoSectionComponent } from './components/video-section/video-section.component';
import { UploadVideoComponent } from './components/upload-video/upload-video.component';
import { UserProfileComponent } from './components/user-profile/user-profile.component';


export const routes: Routes = [
  // Default route redirects to /home
  { path: '', redirectTo: 'home', pathMatch: 'full' },

  // Main route group
  {
    path: '',
    children: [
      { path: 'home', component: VideoSectionComponent },
      { path: 'home/:userId', component: VideoSectionComponent, canActivate: [AuthGuard] },
      { path: 'video/:id', component: VideoPlayerComponent },
      { path: 'upload', component: UploadVideoComponent },
      { path: 'user-profile', component: UserProfileComponent }
    ]
  }
];
