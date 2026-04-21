import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { VideoService, FeedPage } from './video.service';
import { environment } from '../../environments/environment';

describe('VideoService', () => {
  let service: VideoService;
  let httpMock: HttpTestingController;

  const apiUrl = environment.apiUrl;

  const mockFeedPage: FeedPage = {
    videos: [{ _id: 'v1', title: 'Test Video' }],
    nextCursor: 'cursor-abc',
    hasMore: true,
  };

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [VideoService],
    });

    service = TestBed.inject(VideoService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── getFeed() ────────────────────────────────────────────────────────────────

  describe('getFeed()', () => {
    it('should GET /feed with no query params on first page', () => {
      service.getFeed().subscribe((res) => expect(res).toEqual(mockFeedPage));

      const req = httpMock.expectOne(`${apiUrl}/feed`);
      expect(req.request.method).toBe('GET');
      req.flush(mockFeedPage);
    });

    it('should include "cursor" param when provided', () => {
      service.getFeed('cursor-abc').subscribe();

      const req = httpMock.expectOne((r) => r.url === `${apiUrl}/feed`);
      expect(req.request.params.get('cursor')).toBe('cursor-abc');
      req.flush(mockFeedPage);
    });

    it('should include "category" param when not "All"', () => {
      service.getFeed(undefined, 'Gaming').subscribe();

      const req = httpMock.expectOne((r) => r.url === `${apiUrl}/feed`);
      expect(req.request.params.get('category')).toBe('Gaming');
      req.flush(mockFeedPage);
    });

    it('should NOT include "category" param when category is "All"', () => {
      service.getFeed(undefined, 'All').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/feed`);
      expect(req.request.params.has('category')).toBeFalse();
      req.flush(mockFeedPage);
    });

    it('should include both cursor and category when both are provided', () => {
      service.getFeed('cursor-abc', 'Music').subscribe();

      const req = httpMock.expectOne((r) => r.url === `${apiUrl}/feed`);
      expect(req.request.params.get('cursor')).toBe('cursor-abc');
      expect(req.request.params.get('category')).toBe('Music');
      req.flush(mockFeedPage);
    });
  });

  // ── searchVideos() ───────────────────────────────────────────────────────────

  describe('searchVideos()', () => {
    it('should GET /feed/search with the "q" param', () => {
      service.searchVideos('angular').subscribe();

      const req = httpMock.expectOne((r) => r.url === `${apiUrl}/feed/search`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('q')).toBe('angular');
      req.flush({ videos: [] });
    });

    it('should include "category" param when not "All"', () => {
      service.searchVideos('react', 'Education').subscribe();

      const req = httpMock.expectOne((r) => r.url === `${apiUrl}/feed/search`);
      expect(req.request.params.get('category')).toBe('Education');
      req.flush({ videos: [] });
    });

    it('should NOT include "category" param when category is "All"', () => {
      service.searchVideos('vue', 'All').subscribe();

      const req = httpMock.expectOne((r) => r.url === `${apiUrl}/feed/search`);
      expect(req.request.params.has('category')).toBeFalse();
      req.flush({ videos: [] });
    });
  });

  // ── getVideoById() ───────────────────────────────────────────────────────────

  describe('getVideoById()', () => {
    it('should GET /videos/:id', () => {
      service.getVideoById('vid123').subscribe((v) => expect(v._id).toBe('vid123'));

      const req = httpMock.expectOne(`${apiUrl}/videos/vid123`);
      expect(req.request.method).toBe('GET');
      req.flush({ _id: 'vid123', title: 'Hello' });
    });
  });

  // ── getTopLikedVideos() ──────────────────────────────────────────────────────

  describe('getTopLikedVideos()', () => {
    it('should GET /videos/top-liked', () => {
      service.getTopLikedVideos().subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/top-liked`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  // ── getMyVideos() ────────────────────────────────────────────────────────────

  describe('getMyVideos()', () => {
    it('should GET /videos/mine', () => {
      service.getMyVideos().subscribe((videos) => expect(videos).toEqual([]));

      const req = httpMock.expectOne(`${apiUrl}/videos/mine`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  // ── Auth-gated endpoints ─────────────────────────────────────────────────────

  describe('Auth-gated endpoints', () => {
    beforeEach(() => {
      localStorage.setItem('token', 'test-jwt');
    });

    it('getLikedVideos() should GET /videos/liked with Authorization header', () => {
      service.getLikedVideos().subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/liked`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt');
      req.flush([]);
    });

    it('getDislikedVideos() should GET /videos/disliked with Authorization header', () => {
      service.getDislikedVideos().subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/disliked`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt');
      req.flush([]);
    });

    it('likeVideo() should POST to /videos/:id/like with Authorization header', () => {
      service.likeVideo('vid1').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/like`);
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt');
      req.flush({ likes: 1 });
    });

    it('dislikeVideo() should POST to /videos/:id/dislike with Authorization header', () => {
      service.dislikeVideo('vid1').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/dislike`);
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt');
      req.flush({ dislikes: 1 });
    });

    it('getUserReaction() should GET /videos/:id/reaction with Authorization header', () => {
      service.getUserReaction('vid1').subscribe((res) => {
        expect(res.reaction).toBe('like');
      });

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/reaction`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt');
      req.flush({ reaction: 'like' });
    });
  });

  // ── deleteVideo() ────────────────────────────────────────────────────────────

  describe('deleteVideo()', () => {
    it('should DELETE /videos/:id with userId as a query param', () => {
      service.deleteVideo('vid1', 'user1').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1?userId=user1`);
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });

    it('should URI-encode the userId param', () => {
      service.deleteVideo('vid1', 'user with spaces').subscribe();

      const req = httpMock.expectOne(
        `${apiUrl}/videos/vid1?userId=user%20with%20spaces`,
      );
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });

  // ── getCommentCount() ────────────────────────────────────────────────────────

  describe('getCommentCount()', () => {
    it('should GET /videos/:id/comments/count', () => {
      service.getCommentCount('vid1').subscribe((res) => {
        expect(res.count).toBe(7);
      });

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/comments/count`);
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, count: 7 });
    });
  });

  // ── Watch history ────────────────────────────────────────────────────────────

  describe('addToHistory()', () => {
    it('should POST to /history/:videoId with userId in the body', () => {
      service.addToHistory('vid1', 'user1').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/history/vid1`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ userId: 'user1' });
      req.flush({});
    });
  });

  describe('getWatchHistory()', () => {
    it('should GET /history', () => {
      service.getWatchHistory().subscribe();

      const req = httpMock.expectOne(`${apiUrl}/history`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  // ── recordView() ─────────────────────────────────────────────────────────────

  describe('recordView()', () => {
    it('should POST to /videos/:id/view', () => {
      service.recordView('vid1').subscribe((res) => expect(res.views).toBe(5));

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/view`);
      expect(req.request.method).toBe('POST');
      req.flush({ views: 5 });
    });

    it('should send Authorization header when a token exists', () => {
      localStorage.setItem('token', 'jwt-abc');
      service.recordView('vid1').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/view`);
      expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-abc');
      expect(req.request.headers.has('X-Anon-Session')).toBeFalse();
      req.flush({ views: 1 });
    });

    it('should send X-Anon-Session header when no token', () => {
      localStorage.removeItem('token');
      service.recordView('vid1').subscribe();

      const req = httpMock.expectOne(`${apiUrl}/videos/vid1/view`);
      expect(req.request.headers.has('X-Anon-Session')).toBeTrue();
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({ views: 1 });
    });

    it('should reuse the same anon session UUID across multiple calls', () => {
      localStorage.removeItem('token');

      service.recordView('vid1').subscribe();
      const req1 = httpMock.expectOne(`${apiUrl}/videos/vid1/view`);
      const sessionId1 = req1.request.headers.get('X-Anon-Session');
      req1.flush({ views: 1 });

      service.recordView('vid2').subscribe();
      const req2 = httpMock.expectOne(`${apiUrl}/videos/vid2/view`);
      const sessionId2 = req2.request.headers.get('X-Anon-Session');
      req2.flush({ views: 1 });

      expect(sessionId1).toBeTruthy();
      expect(sessionId1).toBe(sessionId2);
    });
  });

  // ── Reactive subjects ─────────────────────────────────────────────────────────

  describe('Reactive subjects', () => {
    describe('search$', () => {
      it('should emit when setSearchTerm() is called', (done) => {
        let first = true;
        service.search$.subscribe((term) => {
          if (!first && term === 'jasmine') {
            expect(term).toBe('jasmine');
            done();
          }
          first = false;
        });
        service.setSearchTerm('jasmine');
      });

      it('should start with an empty string', (done) => {
        service.search$.subscribe((term) => {
          expect(term).toBe('');
          done();
        });
      });
    });

    describe('category$', () => {
      it('should emit "All" as the initial value', (done) => {
        service.category$.subscribe((cat) => {
          expect(cat).toBe('All');
          done();
        });
      });

      it('should emit the new category when setCategory() is called', (done) => {
        let first = true;
        service.category$.subscribe((cat) => {
          if (!first && cat === 'Sports') {
            expect(cat).toBe('Sports');
            done();
          }
          first = false;
        });
        service.setCategory('Sports');
      });
    });

    describe('feedRefresh$', () => {
      it('should emit when triggerFeedRefresh() is called', (done) => {
        service.feedRefresh$.subscribe(() => {
          expect(true).toBeTrue();
          done();
        });
        service.triggerFeedRefresh();
      });
    });
  });
});
