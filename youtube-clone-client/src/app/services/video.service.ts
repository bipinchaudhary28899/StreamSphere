import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable, BehaviorSubject } from "rxjs";

// video.service.ts
@Injectable({
  providedIn: 'root'
})
export class VideoService {
  private apiUrl = 'http://localhost:3000/api/home'; // Change to your backend URL
  private searchSubject = new BehaviorSubject<string>('');
  private categorySubject = new BehaviorSubject<string>('All');
  public search$ = this.searchSubject.asObservable();
  public category$ = this.categorySubject.asObservable();

  constructor(private http: HttpClient) { }

  getAllVideos(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  getVideosByCategory(category: string): Observable<any[]> {
    const url = category === 'All' ? this.apiUrl : `http://localhost:3000/api/videos/category/${encodeURIComponent(category)}`;
    return this.http.get<any[]>(url);
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