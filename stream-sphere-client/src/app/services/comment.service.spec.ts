import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CommentService, Comment } from './comment.service';
import { environment } from '../../environments/environment';

describe('CommentService', () => {
  let service: CommentService;
  let httpMock: HttpTestingController;

  const apiUrl = environment.apiUrl;

  const mockComment: Comment = {
    _id: 'c1',
    video_id: 'vid1',
    user_id: 'user1',
    username: 'testuser',
    content: 'Great video!',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    replies_count: 0,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CommentService],
    });

    service = TestBed.inject(CommentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── getCommentsByVideoId() ───────────────────────────────────────────────────

  describe('getCommentsByVideoId()', () => {
    it('should GET /videos/:id/comments', () => {
      service.getCommentsByVideoId('vid1').subscribe((res) => {
        expect(res.success).toBeTrue();
        expect(res.comments.length).toBe(1);
        expect(res.comments[0]._id).toBe('c1');
      });

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/comments`);
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, comments: [mockComment] });
    });

    it('should return an empty comments array when there are no comments', () => {
      service.getCommentsByVideoId('vid2').subscribe((res) => {
        expect(res.comments).toEqual([]);
      });

      const req = httpMock.expectOne(`${apiUrl}/videos/vid2/comments`);
      req.flush({ success: true, comments: [] });
    });
  });

  // ── createComment() ──────────────────────────────────────────────────────────

  describe('createComment()', () => {
    it('should POST to /videos/:id/comments with the correct body', () => {
      service.createComment('vid1', 'Great video!').subscribe((res) => {
        expect(res.comment._id).toBe('c1');
      });

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/comments`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        video_id: 'vid1',
        content: 'Great video!',
      });
      req.flush({ success: true, comment: mockComment });
    });

    it('should use the videoId from the argument as video_id in the body', () => {
      service.createComment('vid99', 'Hello!').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/vid99/comments`);
      expect(req.request.body.video_id).toBe('vid99');
      req.flush({ success: true, comment: { ...mockComment, video_id: 'vid99' } });
    });
  });

  // ── updateComment() ──────────────────────────────────────────────────────────

  describe('updateComment()', () => {
    it('should PUT to /comments/:id with the new content', () => {
      const updated = { ...mockComment, content: 'Updated content' };

      service.updateComment('c1', 'Updated content').subscribe((res) => {
        expect(res.comment.content).toBe('Updated content');
      });

      const req = httpMock.expectOne(`${apiUrl}/comments/c1`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ content: 'Updated content' });
      req.flush({ success: true, comment: updated });
    });

    it('should include only the "content" field in the request body', () => {
      service.updateComment('c1', 'New text').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/comments/c1`);
      const bodyKeys = Object.keys(req.request.body);
      expect(bodyKeys).toEqual(['content']);
      req.flush({ success: true, comment: mockComment });
    });
  });

  // ── deleteComment() ──────────────────────────────────────────────────────────

  describe('deleteComment()', () => {
    it('should DELETE /comments/:id', () => {
      service.deleteComment('c1').subscribe((res) => {
        expect(res.success).toBeTrue();
        expect(res.message).toBe('Deleted');
      });

      const req = httpMock.expectOne(`${apiUrl}/comments/c1`);
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true, message: 'Deleted' });
    });

    it('should propagate errors to the subscriber', () => {
      let statusCode: number | undefined;

      service.deleteComment('c1').subscribe({
        error: (err) => (statusCode = err.status),
      });

      const req = httpMock.expectOne(`${apiUrl}/comments/c1`);
      req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

      expect(statusCode).toBe(403);
    });
  });

  // ── getCommentCount() ────────────────────────────────────────────────────────

  describe('getCommentCount()', () => {
    it('should GET /videos/:id/comments/count', () => {
      service.getCommentCount('vid1').subscribe((res) => {
        expect(res.success).toBeTrue();
        expect(res.count).toBe(3);
      });

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/comments/count`);
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, count: 3 });
    });

    it('should return 0 when there are no comments', () => {
      service.getCommentCount('vid1').subscribe((res) => {
        expect(res.count).toBe(0);
      });

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/comments/count`);
      req.flush({ success: true, count: 0 });
    });
  });

  // ── getUserComments() ────────────────────────────────────────────────────────

  describe('getUserComments()', () => {
    it('should GET /user/comments', () => {
      service.getUserComments().subscribe((res) => {
        expect(res.success).toBeTrue();
      });

      const req = httpMock.expectOne(`${apiUrl}/user/comments`);
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, comments: [] });
    });
  });

  // ── getReplies() ─────────────────────────────────────────────────────────────

  describe('getReplies()', () => {
    it('should GET /comments/:id/replies', () => {
      const mockReply: Comment = {
        ...mockComment,
        _id: 'r1',
        parent_id: 'c1',
        content: 'Nice reply!',
      };

      service.getReplies('c1').subscribe((res) => {
        expect(res.success).toBeTrue();
        expect(res.replies.length).toBe(1);
        expect(res.replies[0]._id).toBe('r1');
        expect(res.replies[0].parent_id).toBe('c1');
      });

      const req = httpMock.expectOne(`${apiUrl}/comments/c1/replies`);
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, replies: [mockReply] });
    });

    it('should return an empty replies array when there are none', () => {
      service.getReplies('c1').subscribe((res) => {
        expect(res.replies).toEqual([]);
      });

      const req = httpMock.expectOne(`${apiUrl}/comments/c1/replies`);
      req.flush({ success: true, replies: [] });
    });
  });

  // ── createReply() ────────────────────────────────────────────────────────────

  describe('createReply()', () => {
    it('should POST to /videos/:id/comments with parent_id in the body', () => {
      service.createReply('vid1', 'Nice reply!', 'c1').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/comments`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        video_id: 'vid1',
        content: 'Nice reply!',
        parent_id: 'c1',
      });
      req.flush({ success: true, comment: mockComment });
    });

    it('should use the same endpoint as createComment but with a parent_id', () => {
      // Verify reply and comment share the same URL
      service.createReply('vid2', 'Reply!', 'parent-c').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/vid2/comments`);
      expect(req.request.body.parent_id).toBe('parent-c');
      req.flush({ success: true, comment: mockComment });
    });
  });
});
