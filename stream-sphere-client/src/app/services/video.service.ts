import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable, BehaviorSubject } from "rxjs";
import { environment } from '../../environments/environment';
import { HttpHeaders } from '@angular/common/http';

// video.service.ts
@Injectable({
  providedIn: 'root'
})
export class VideoService {
  private apiUrl = environment.apiUrl;
  private searchSubject = new BehaviorSubject<string>('');
  private categorySubject = new BehaviorSubject<string>('All');
  public search$ = this.searchSubject.asObservable();
  public category$ = this.categorySubject.asObservable();

  constructor(private http: HttpClient) { }

  getAllVideos(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/home`);
  }

  getVideosByCategory(category: string): Observable<any[]> {
    const url = category === 'All' ? `${this.apiUrl}/home` : `${this.apiUrl}/videos/category/${encodeURIComponent(category)}`;
    return this.http.get<any[]>(url);
  }

  deleteVideo(videoId: string, userId: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/videos/${videoId}`, {
      body: { userId }
    });
  }

  likeVideo(videoId: string) {
    const token = localStorage.getItem('token');
    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return this.http.post<any>(`${this.apiUrl}/videos/${videoId}/like`, {}, { headers });
  }

  dislikeVideo(videoId: string) {
    const token = localStorage.getItem('token');
    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return this.http.post<any>(`${this.apiUrl}/videos/${videoId}/dislike`, {}, { headers });
  }

  getUserReaction(videoId: string) {
    const token = localStorage.getItem('token');
    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return this.http.get<{ reaction: string }>(`${this.apiUrl}/videos/${videoId}/reaction`, { headers });
  }

  getLikedVideos(): Observable<any[]> {
    const token = localStorage.getItem('token');
    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return this.http.get<any[]>(`${this.apiUrl}/videos/liked`, { headers });
  }

  getTopLikedVideos(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/videos/top-liked`);
  }

  getDislikedVideos(): Observable<any[]> {
    const token = localStorage.getItem('token');
    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return this.http.get<any[]>(`${this.apiUrl}/videos/disliked`, { headers });
  }

  setSearchTerm(term: string): void {
    console.log('Video service setting search term:', term);
    this.searchSubject.next(term);
  }

  setCategory(category: string): void {
    console.log('Video service setting category:', category);
    this.categorySubject.next(category);
  }
}