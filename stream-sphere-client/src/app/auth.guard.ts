import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  constructor(private router: Router) {}

  canActivate(): boolean {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
      try {
        // Verify user data is valid JSON
        const userData = JSON.parse(user);
        if (userData && userData.userId) {
          return true;
        }
      } catch (error) {
        console.error('Invalid user data in localStorage:', error);
      }
    }
    
    // No valid token or user data, redirect to home
    this.router.navigate(['/home'], { replaceUrl: true });
    return false;
  }
}
