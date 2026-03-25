import { Routes } from '@angular/router';
import { AuthGuard } from './auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },

  // Home (keep eager for fast load)
  {
    path: 'home',
    loadComponent: () =>
      import('./components/video-list/video-list.component')
        .then(c => c.VideoListComponent)
  },

  {
    path: 'home/:userId',
    loadComponent: () =>
      import('./components/video-list/video-list.component')
        .then(c => c.VideoListComponent),
    canActivate: [AuthGuard]
  },

  // Lazy loaded protected routes
  {
    path: 'upload',
    loadComponent: () =>
      import('./components/upload-video/upload-video.component')
        .then(c => c.UploadVideoComponent),
    canActivate: [AuthGuard]
  },

  {
    path: 'user-profile',
    loadComponent: () =>
      import('./components/user-profile/user-profile.component')
        .then(c => c.UserProfileComponent),
    canActivate: [AuthGuard]
  },

  {
    path: 'video/:id',
    loadComponent: () =>
      import('./components/video-player/video-player.component')
        .then(c => c.VideoPlayerComponent)
  },

  { path: '**', redirectTo: 'home' }
];