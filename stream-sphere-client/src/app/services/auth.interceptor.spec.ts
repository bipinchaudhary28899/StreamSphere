import { TestBed } from '@angular/core/testing';
import {
  provideHttpClient,
  withInterceptors,
  HttpClient,
} from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthInterceptor } from './auth.interceptor';

describe('AuthInterceptor', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([AuthInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  // ── JWT header injection ──────────────────────────────────────────────────────

  describe('JWT header injection', () => {
    it('should add Authorization header when a token is in localStorage', () => {
      localStorage.setItem('token', 'my-jwt');

      http.get('/api/test').subscribe();

      const req = httpMock.expectOne('/api/test');
      expect(req.request.headers.get('Authorization')).toBe('Bearer my-jwt');
      req.flush({});
    });

    it('should NOT add Authorization header when no token is stored', () => {
      localStorage.removeItem('token');

      http.get('/api/test').subscribe();

      const req = httpMock.expectOne('/api/test');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    });

    it('should pass through requests normally when a token is present', () => {
      localStorage.setItem('token', 'my-jwt');
      let body: any;

      http.get('/api/data').subscribe((res) => (body = res));

      const req = httpMock.expectOne('/api/data');
      req.flush({ data: 'value' });

      expect(body).toEqual({ data: 'value' });
    });
  });

  // ── S3 bypass ─────────────────────────────────────────────────────────────────

  describe('S3 (amazonaws.com) bypass', () => {
    it('should NOT add Authorization header to amazonaws.com URLs', () => {
      localStorage.setItem('token', 'my-jwt');

      http.put('https://my-bucket.s3.amazonaws.com/video.mp4', {}).subscribe();

      const req = httpMock.expectOne(
        'https://my-bucket.s3.amazonaws.com/video.mp4',
      );
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    });

    it('should still send the S3 request normally after bypassing', () => {
      let responded = false;

      http
        .put('https://bucket.s3.amazonaws.com/file.mp4', { data: true })
        .subscribe(() => (responded = true));

      const req = httpMock.expectOne(
        'https://bucket.s3.amazonaws.com/file.mp4',
      );
      req.flush({});

      expect(responded).toBeTrue();
    });
  });

  // ── 401 error handling ────────────────────────────────────────────────────────

  describe('401 error handling', () => {
    it('should clear "token" from localStorage on 401', () => {
      localStorage.setItem('token', 'expired-token');

      http.get('/api/protected').subscribe({ error: () => {} });

      const req = httpMock.expectOne('/api/protected');
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      expect(localStorage.getItem('token')).toBeNull();
    });

    it('should clear "user" from localStorage on 401', () => {
      localStorage.setItem('user', JSON.stringify({ userId: '1' }));

      http.get('/api/protected').subscribe({ error: () => {} });

      const req = httpMock.expectOne('/api/protected');
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      expect(localStorage.getItem('user')).toBeNull();
    });

    it('should navigate to /home on 401', () => {
      spyOn(router, 'navigate');

      http.get('/api/protected').subscribe({ error: () => {} });

      const req = httpMock.expectOne('/api/protected');
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      expect(router.navigate).toHaveBeenCalledWith(['/home']);
    });

    it('should re-throw the 401 error so the subscriber receives it', () => {
      let receivedStatus: number | undefined;

      http.get('/api/protected').subscribe({
        error: (e) => (receivedStatus = e.status),
      });

      const req = httpMock.expectOne('/api/protected');
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      expect(receivedStatus).toBe(401);
    });
  });

  // ── Non-401 errors ────────────────────────────────────────────────────────────

  describe('Non-401 error handling', () => {
    it('should NOT clear localStorage on 403 error', () => {
      localStorage.setItem('token', 'valid-token');
      localStorage.setItem('user', JSON.stringify({ userId: '1' }));

      http.get('/api/admin').subscribe({ error: () => {} });

      const req = httpMock.expectOne('/api/admin');
      req.flush('Forbidden', { status: 403, statusText: 'Forbidden' });

      expect(localStorage.getItem('token')).toBe('valid-token');
      expect(localStorage.getItem('user')).not.toBeNull();
    });

    it('should NOT clear localStorage on 404 error', () => {
      localStorage.setItem('token', 'valid-token');

      http.get('/api/missing').subscribe({ error: () => {} });

      const req = httpMock.expectOne('/api/missing');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });

      expect(localStorage.getItem('token')).toBe('valid-token');
    });

    it('should NOT navigate on 500 error', () => {
      spyOn(router, 'navigate');

      http.get('/api/broken').subscribe({ error: () => {} });

      const req = httpMock.expectOne('/api/broken');
      req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });

      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('should still re-throw non-401 errors to the subscriber', () => {
      let receivedStatus: number | undefined;

      http.get('/api/missing').subscribe({
        error: (e) => (receivedStatus = e.status),
      });

      const req = httpMock.expectOne('/api/missing');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });

      expect(receivedStatus).toBe(404);
    });
  });
});
