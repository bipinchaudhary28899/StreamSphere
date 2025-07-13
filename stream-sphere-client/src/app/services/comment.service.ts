import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Comment {
  _id: string;
  video_id: string;
  user_id: string;
  username: string;
  user_profile_image?: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCommentRequest {
  video_id: string;
  content: string;
}

export interface UpdateCommentRequest {
  content: string;
}

@Injectable({
  providedIn: 'root'
})
export class CommentService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  // Get all comments for a video
  getCommentsByVideoId(videoId: string): Observable<{ success: boolean; comments: Comment[] }> {
    return this.http.get<{ success: boolean; comments: Comment[] }>(`${this.apiUrl}/videos/${videoId}/comments`);
  }

  // Create a new comment
  createComment(videoId: string, content: string): Observable<{ success: boolean; comment: Comment }> {
    const token = localStorage.getItem('token');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    
    const commentData: CreateCommentRequest = {
      video_id: videoId,
      content: content
    };

    return this.http.post<{ success: boolean; comment: Comment }>(
      `${this.apiUrl}/videos/${videoId}/comments`,
      commentData,
      { headers }
    );
  }

  // Update a comment
  updateComment(commentId: string, content: string): Observable<{ success: boolean; comment: Comment }> {
    const token = localStorage.getItem('token');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    
    const updateData: UpdateCommentRequest = {
      content: content
    };

    return this.http.put<{ success: boolean; comment: Comment }>(
      `${this.apiUrl}/comments/${commentId}`,
      updateData,
      { headers }
    );
  }

  // Delete a comment
  deleteComment(commentId: string): Observable<{ success: boolean; message: string }> {
    const token = localStorage.getItem('token');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);

    return this.http.delete<{ success: boolean; message: string }>(
      `${this.apiUrl}/comments/${commentId}`,
      { headers }
    );
  }

  // Get comment count for a video
  getCommentCount(videoId: string): Observable<{ success: boolean; count: number }> {
    return this.http.get<{ success: boolean; count: number }>(`${this.apiUrl}/videos/${videoId}/comments/count`);
  }

  // Get comments by current user
  getUserComments(): Observable<{ success: boolean; comments: Comment[] }> {
    const token = localStorage.getItem('token');
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);

    return this.http.get<{ success: boolean; comments: Comment[] }>(
      `${this.apiUrl}/user/comments`,
      { headers }
    );
  }
} 