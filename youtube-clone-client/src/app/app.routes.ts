import { Routes } from '@angular/router';
import { AppComponent } from './app.component';
import { VideoPlayerComponent } from './components/video-player/video-player.component';
import { AuthGuard } from './auth.guard';
import { VideoListComponent } from './components/video-list/video-list.component';
import { UploadVideoComponent } from './components/upload-video/upload-video.component';
import { UserProfileComponent } from './components/user-profile/user-profile.component';

export const routes: Routes = [
  // Default route redirects to /home
  { path: '', redirectTo: 'home', pathMatch: 'full' },

  // Main route group
  {
    path: '',
    children: [
      // Public routes
      { path: 'home', component: VideoListComponent },
      
      // Protected routes
      { path: 'home/:userId', component: VideoListComponent, canActivate: [AuthGuard] },
      { path: 'upload', component: UploadVideoComponent, canActivate: [AuthGuard] },
      { path: 'user-profile', component: UserProfileComponent, canActivate: [AuthGuard] },
      
      // Video player route
      { path: 'video/:id', component: VideoPlayerComponent },
      
      // 404 route - redirect to home
      { path: '**', redirectTo: 'home' }
    ]
  }
];
