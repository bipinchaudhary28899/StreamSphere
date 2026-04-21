import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommentService, Comment } from '../../services/comment.service';
import { AuthService } from '../../services/auth.service';
import { Subscription } from 'rxjs';

export interface CommentUI extends Comment {
  replies: Comment[];
  showReplies: boolean;
  loadingReplies: boolean;
  showReplyForm: boolean;
  replyContent: string;
  submittingReply: boolean;
}

@Component({
  selector: 'app-comment-section',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comment-section.component.html',
  styleUrls: ['./comment-section.component.css']
})
export class CommentSectionComponent implements OnInit, OnDestroy {
  @Input() videoId: string = '';

  comments: CommentUI[] = [];
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
    if (this.isLoggedIn) this.loadCurrentUser();
  }

  loadCurrentUser(): void {
    const userData = localStorage.getItem('user');
    if (userData) {
      try { this.currentUser = JSON.parse(userData); }
      catch { this.currentUser = null; }
    }
  }

  loadComments(): void {
    if (!this.videoId) return;
    this.loading = true;
    this.subscriptions.push(
      this.commentService.getCommentsByVideoId(this.videoId).subscribe({
        next: (response) => {
          this.comments = response.comments.map(c => this.toUI(c));
          this.loading = false;
        },
        error: () => { this.loading = false; }
      })
    );
  }

  private toUI(c: Comment): CommentUI {
    return {
      ...c,
      replies: [],
      showReplies: false,
      loadingReplies: false,
      showReplyForm: false,
      replyContent: '',
      submittingReply: false,
    };
  }

  // ── Top-level comment ────────────────────────────────────────────────────────

  submitComment(): void {
    if (!this.newComment.trim() || !this.isLoggedIn) return;
    this.submitting = true;
    this.subscriptions.push(
      this.commentService.createComment(this.videoId, this.newComment.trim()).subscribe({
        next: (response) => {
          this.comments.unshift(this.toUI(response.comment));
          this.newComment = '';
          this.submitting = false;
        },
        error: () => { this.submitting = false; }
      })
    );
  }

  startEdit(comment: CommentUI): void {
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
          const idx = this.comments.findIndex(c => c._id === commentId);
          if (idx !== -1) {
            this.comments[idx] = { ...this.comments[idx], ...response.comment };
          }
          this.editingCommentId = null;
          this.editContent = '';
        },
        error: (err) => console.error('Error updating comment:', err)
      })
    );
  }

  deleteComment(commentId: string): void {
    if (!confirm('Delete this comment and all its replies?')) return;
    this.subscriptions.push(
      this.commentService.deleteComment(commentId).subscribe({
        next: () => { this.comments = this.comments.filter(c => c._id !== commentId); },
        error: (err) => console.error('Error deleting comment:', err)
      })
    );
  }

  // ── Replies ──────────────────────────────────────────────────────────────────

  toggleReplies(comment: CommentUI): void {
    if (comment.showReplies) {
      comment.showReplies = false;
      return;
    }
    if (comment.replies.length > 0) {
      comment.showReplies = true;
      return;
    }
    comment.loadingReplies = true;
    this.subscriptions.push(
      this.commentService.getReplies(comment._id).subscribe({
        next: (res) => {
          comment.replies = res.replies;
          comment.showReplies = true;
          comment.loadingReplies = false;
        },
        error: () => { comment.loadingReplies = false; }
      })
    );
  }

  openReplyForm(comment: CommentUI): void {
    // Close all other reply forms first
    this.comments.forEach(c => { if (c._id !== comment._id) c.showReplyForm = false; });
    comment.showReplyForm = !comment.showReplyForm;
    comment.replyContent = '';
  }

  submitReply(comment: CommentUI): void {
    if (!comment.replyContent.trim() || !this.isLoggedIn) return;
    comment.submittingReply = true;
    this.subscriptions.push(
      this.commentService.createReply(this.videoId, comment.replyContent.trim(), comment._id).subscribe({
        next: (res) => {
          comment.replies.push(res.comment);
          comment.replies_count = (comment.replies_count || 0) + 1;
          comment.showReplies = true;
          comment.showReplyForm = false;
          comment.replyContent = '';
          comment.submittingReply = false;
        },
        error: () => { comment.submittingReply = false; }
      })
    );
  }

  deleteReply(reply: Comment, parent: CommentUI): void {
    if (!confirm('Delete this reply?')) return;
    this.subscriptions.push(
      this.commentService.deleteComment(reply._id).subscribe({
        next: () => {
          parent.replies = parent.replies.filter(r => r._id !== reply._id);
          parent.replies_count = Math.max(0, (parent.replies_count || 1) - 1);
        },
        error: (err) => console.error('Error deleting reply:', err)
      })
    );
  }

  // ── Permissions ───────────────────────────────────────────────────────────────

  isOwner(comment: Comment): boolean {
    const uid = this.currentUser?._id || this.currentUser?.userId || this.currentUser?.id;
    return this.isLoggedIn && !!this.currentUser && comment.user_id === uid;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  get totalComments(): number {
    return this.comments.reduce((acc, c) => acc + 1 + (c.replies_count || 0), 0);
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
  }

  getDefaultAvatar(username: string): string {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff&size=40`;
  }
}
