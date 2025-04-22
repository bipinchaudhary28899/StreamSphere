import { Routes } from '@angular/router';
import { UserLoginComponent } from './user-login/user-login.component';
import { AppComponent } from './app.component';
import { VideoPlayerComponent } from './components/video-player/video-player.component';


export const routes: Routes = [
  { path: 'login', component: UserLoginComponent },
  { path: '', redirectTo: '/login', pathMatch: 'full' },  // Redirect to /login when accessing root,
  { path: '', component: AppComponent },
  { path: 'video/:id', component: VideoPlayerComponent }
];
