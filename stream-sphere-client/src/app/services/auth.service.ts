import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  googleLogin(token: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/google-login`, { token });
  }

  getRedirectUrl(): string | null {
    return sessionStorage.getItem('redirectUrl');
  }
}
