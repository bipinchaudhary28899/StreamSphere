import { Routes } from '@angular/router';
import { UserLoginComponent } from './user-login/user-login.component';
import { HomeComponent } from './components/home/home.component';

export const routes: Routes = [
  { path: 'login', component: UserLoginComponent },
  { path: '', redirectTo: '/login', pathMatch: 'full' },  // Redirect to /login when accessing root,
  { path: 'home/userdetail', component: HomeComponent }, // Add this route
];
