import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private baseUrl = 'http://localhost:3000/api'; // Update if different

  constructor(private http: HttpClient) {}

  googleLogin(token: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/google-login`, { token });
  }

  // Optional: Add getRedirectUrl() if used in your component
  getRedirectUrl(): string | null {
    // Example logic – can be from localStorage or session, based on your app
    return sessionStorage.getItem('redirectUrl');
  }
}
