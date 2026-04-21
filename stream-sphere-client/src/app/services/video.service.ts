import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, Subject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface FeedPage {
  videos:     any[];
  nextCursor: string | null;
  hasMore:    boolean;
}

@Injectable({ providedIn: 'root' })
export class VideoService {
  private apiUrl = environment.apiUrl;

  // ── Reactive state shared with header (search + category) ──────────────────
  private searchSubject   = new BehaviorSubject<string>('');
  private categorySubject = new BehaviorSubject<string>('All');
  public  search$   = this.searchSubject.asObservable();
  public  category$ = this.categorySubject.asObservable();

  // ── Feed refresh signal — emitted after a successful upload ─────────────────
  private feedRefreshSubject = new Subject<void>();
  public  feedRefresh$ = this.feedRefreshSubject.asObservable();

  triggerFeedRefresh(): void { this.feedRefreshSubject.next(); }

  constructor(private http: HttpClient) {}

  // ── Feed (cursor-paginated) ─────────────────────────────────────────────────

  /**
   * Fetch one page of the home/category feed.
   * Returns { videos, nextCursor, hasMore }.
   *
   * cursor   — pass undefined for the first page; pass the value from the
   *            previous response for subsequent pages.
   * category — 'All' or a specific category string.
   */
  getFeed(cursor?: string, category?: string): Observable<FeedPage> {
    const params: Record<string, string> = {};
    if (cursor)                           params['cursor']   = cursor;
    if (category && category !== 'All')   params['category'] = category;

    return this.http.get<FeedPage>(`${this.apiUrl}/feed`, { params });
  }

  /**
   * Server-side search — returns { videos: [] }.
   * Optionally scoped to a category so results respect the active filter.
   */
  searchVideos(term: string, category?: string): Observable<{ videos: any[] }> {
    const params: Record<string, string> = { q: term };
    if (category && category !== 'All') params['category'] = category;
    return this.http.get<{ videos: any[] }>(`${this.apiUrl}/feed/search`, { params });
  }

  /** Fetch a single video document by its MongoDB _id (cached 10 min in Redis) */
  getVideoById(videoId: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/videos/${videoId}`);
  }

  // ── Top-liked (hero carousel) ───────────────────────────────────────────────
  getTopLikedVideos(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/videos/top-liked`);
  }

  // ── User-specific lists ─────────────────────────────────────────────────────
  getLikedVideos(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/videos/liked`, { headers: this.authHeaders() });
  }

  getDislikedVideos(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/videos/disliked`, { headers: this.authHeaders() });
  }

  // ── Reactions ───────────────────────────────────────────────────────────────
  likeVideo(videoId: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/videos/${videoId}/like`, {}, { headers: this.authHeaders() });
  }

  dislikeVideo(videoId: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/videos/${videoId}/dislike`, {}, { headers: this.authHeaders() });
  }

  getUserReaction(videoId: string): Observable<{ reaction: string }> {
    return this.http.get<{ reaction: string }>(`${this.apiUrl}/videos/${videoId}/reaction`, { headers: this.authHeaders() });
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  deleteVideo(videoId: string, userId: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/videos/${videoId}?userId=${encodeURIComponent(userId)}`);
  }

  // ── Comments ────────────────────────────────────────────────────────────────
  getCommentCount(videoId: string): Observable<{ success: boolean; count: number }> {
    return this.http.get<{ success: boolean; count: number }>(`${this.apiUrl}/videos/${videoId}/comments/count`);
  }

  // ── Watch history ───────────────────────────────────────────────────────────
  addToHistory(videoId: string, userId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/history/${videoId}`, { userId });
  }

  getWatchHistory(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/history`);
  }

  // ── View count ──────────────────────────────────────────────────────────
  // Sends auth token (logged-in) OR a persistent anon session UUID so the
  // backend can build a per-browser dedup key regardless of login state.
  recordView(videoId: string): Observable<{ views: number }> {
    const token = localStorage.getItem('token');
    const headers = token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders({ 'X-Anon-Session': this.getAnonSessionId() });
    return this.http.post<{ views: number }>(`${this.apiUrl}/videos/${videoId}/view`, {}, { headers });
  }

  // Returns a stable UUID for this browser, creating one on first visit.
  private getAnonSessionId(): string {
    let id = localStorage.getItem('ss_session_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('ss_session_id', id);
    }
    return id;
  }

  // ── Header reactive subjects ────────────────────────────────────────────────
  setSearchTerm(term: string): void   { this.searchSubject.next(term); }
  setCategory(category: string): void { this.categorySubject.next(category); }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('token');
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }
}
