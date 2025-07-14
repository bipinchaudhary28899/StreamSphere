import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommentService, Comment } from '../../services/comment.service';
import { AuthService } from '../../services/auth.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-comment-section',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comment-section.component.html',
  styleUrls: ['./comment-section.component.css']
})
export class CommentSectionComponent implements OnInit, OnDestroy {
  @Input() videoId: string = '';
  
  comments: Comment[] = [];
  newComment: string = '';
  isLoggedIn: boolean = false;
  currentUser: any = null;
  loading: boolean = false;
  submitting: boolean = false;
  editingCommentId: string | null = null;
  editContent: string = '';
  
  private subscriptions: Subscription[] = [];

  constructor(
    private commentService: CommentService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.checkLoginState();
    this.loadComments();
    
    // Subscribe to login state changes
    this.subscriptions.push(
      this.authService.getLoginState().subscribe(isLoggedIn => {
        this.isLoggedIn = isLoggedIn;
        this.loadCurrentUser();
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  checkLoginState(): void {
    const user = localStorage.getItem('user');
    this.isLoggedIn = !!user;
    if (this.isLoggedIn) {
      this.loadCurrentUser();
    }
  }

  loadCurrentUser(): void {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        this.currentUser = JSON.parse(userData);
      } catch (error) {
        console.error('Error parsing user data:', error);
        this.currentUser = null;
      }
    }
  }

  loadComments(): void {
    if (!this.videoId) return;
    
    this.loading = true;
    this.subscriptions.push(
      this.commentService.getCommentsByVideoId(this.videoId).subscribe({
        next: (response) => {
          this.comments = response.comments;
          this.loading = false;
        },
        error: (error) => {
          console.error('Error loading comments:', error);
          this.loading = false;
        }
      })
    );
  }

  submitComment(): void {
    if (!this.newComment.trim() || !this.isLoggedIn) return;
    
    this.submitting = true;
    this.subscriptions.push(
      this.commentService.createComment(this.videoId, this.newComment.trim()).subscribe({
        next: (response) => {
          this.comments.unshift(response.comment);
          this.newComment = '';
          this.submitting = false;
        },
        error: (error) => {
          console.error('Error creating comment:', error);
          this.submitting = false;
        }
      })
    );
  }

  startEdit(comment: Comment): void {
    this.editingCommentId = comment._id;
    this.editContent = comment.content;
  }

  cancelEdit(): void {
    this.editingCommentId = null;
    this.editContent = '';
  }

  updateComment(commentId: string): void {
    if (!this.editContent.trim()) return;
    
    this.subscriptions.push(
      this.commentService.updateComment(commentId, this.editContent.trim()).subscribe({
        next: (response) => {
          const index = this.comments.findIndex(c => c._id === commentId);
          if (index !== -1) {
            this.comments[index] = response.comment;
          }
          this.editingCommentId = null;
          this.editContent = '';
        },
        error: (error) => {
          console.error('Error updating comment:', error);
        }
      })
    );
  }

  deleteComment(commentId: string): void {
    if (!confirm('Are you sure you want to delete this comment?')) return;
    
    this.subscriptions.push(
      this.commentService.deleteComment(commentId).subscribe({
        next: () => {
          this.comments = this.comments.filter(c => c._id !== commentId);
        },
        error: (error) => {
          console.error('Error deleting comment:', error);
        }
      })
    );
  }

  canEditComment(comment: Comment): boolean {
    const userId = this.currentUser?._id || this.currentUser?.userId || this.currentUser?.id;
    const canEdit = this.isLoggedIn && this.currentUser && comment.user_id === userId;
    return canEdit;
  }

  canDeleteComment(comment: Comment): boolean {
    const userId = this.currentUser?._id || this.currentUser?.userId || this.currentUser?.id;
    const canDelete = this.isLoggedIn && this.currentUser && comment.user_id === userId;
    return canDelete;
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) {
      return 'Just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (diffInSeconds < 2592000) {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  getDefaultAvatar(username: string): string {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff&size=40`;
  }
} 