import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private baseUrl = environment.apiUrl;
  private loginStateSubject = new BehaviorSubject<boolean>(false);

  constructor(private http: HttpClient) {
    // Initialize login state from localStorage
    this.checkInitialLoginState();
  }

  private checkInitialLoginState() {
    const userData = localStorage.getItem('user');
    const isLoggedIn = !!userData;
    this.loginStateSubject.next(isLoggedIn);
  }

  googleLogin(token: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/google-login`, { token });
  }

  getRedirectUrl(): string | null {
    return sessionStorage.getItem('redirectUrl');
  }

  // Observable to subscribe to login state changes
  getLoginState(): Observable<boolean> {
    return this.loginStateSubject.asObservable();
  }

  // Method to update login state
  updateLoginState(isLoggedIn: boolean) {
    // Use setTimeout to defer the state change to the next change detection cycle
    setTimeout(() => {
      this.loginStateSubject.next(isLoggedIn);
    });
  }

  // Method to get current login state
  isLoggedIn(): boolean {
    return this.loginStateSubject.value;
  }
}
