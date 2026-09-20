import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AuthInterceptor } from './auth.interceptor';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpEventType } from '@angular/common/http';
import { ProfileService } from './profile.service';
import { environment } from '../../environments/environment';

describe('ProfileService', () => {
  const api = environment.apiUrl;
  const storedUser = { userId: 'u1', name: 'Ada', email: 'ada@example.com', profileImage: 'https://lh3.googleusercontent.com/a', role: 'user' };

  let service: ProfileService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.setItem('user', JSON.stringify(storedUser));
    localStorage.setItem('token', 'old-token');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([AuthInterceptor])), provideHttpClientTesting(), provideRouter([])],
    });
    service = TestBed.inject(ProfileService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('starts from the stored user', () => {
    expect(service.user?.userId).toBe('u1');
  });

  it('asks the API to sign an upload for the cropped image', () => {
    service.requestUpload('banner', 'image/webp', 1234).subscribe();
    const req = http.expectOne(`${api}/profile/image-upload`);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer old-token');
    expect(req.request.body).toEqual({ kind: 'banner', contentType: 'image/webp', size: 1234 });
    req.flush({ uploadUrl: 'https://s3.example/x', key: 'k', headers: {} });
  });

  it('PUTs the image to S3 with the signed headers and reports progress', () => {
    const image = new Blob(['12345678'], { type: 'image/webp' });
    const ticket = {
      // Not an amazonaws.com host (e.g. a custom domain): the token must still stay out
      uploadUrl: 'https://media.example.com/Videos/profiles/u1/avatar-x.webp?X-Amz-Signature=abc',
      key: 'Videos/profiles/u1/avatar-x.webp',
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' },
    };
    const progress: number[] = [];
    let done = false;
    service.upload(ticket, image).subscribe({ next: p => progress.push(p), complete: () => (done = true) });

    const req = http.expectOne(ticket.uploadUrl);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toBe(image);
    expect(req.request.headers.get('Content-Type')).toBe('image/webp');
    expect(req.request.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    // S3's presigned URL must not also carry our session token
    expect(req.request.headers.has('Authorization')).toBeFalse();

    req.event({ type: HttpEventType.UploadProgress, loaded: 4, total: 8 });
    req.flush(null);
    expect(progress).toEqual([50, 100]);
    expect(done).toBeTrue();
  });

  it('stores the saved profile and the new token, and announces the change', () => {
    const seen: (string | undefined)[] = [];
    service.user$.subscribe(user => seen.push(user?.profileImage));

    service.save({ avatar: { source: 'preset', presetId: 'orbit' } }).subscribe();
    const req = http.expectOne(`${api}/profile`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ avatar: { source: 'preset', presetId: 'orbit' } });
    req.flush({
      user: { userId: 'u1', profileImage: '/assets/profile/avatars/orbit.svg', avatarSource: 'preset' },
      token: 'new-token',
    });

    const stored = JSON.parse(localStorage.getItem('user')!);
    expect(stored.profileImage).toBe('/assets/profile/avatars/orbit.svg');
    expect(stored.role).toBe('user'); // fields the API doesn't send are kept
    expect(localStorage.getItem('token')).toBe('new-token');
    expect(seen[seen.length - 1]).toBe('/assets/profile/avatars/orbit.svg');
  });

  it('does not sign the user back in when they signed out during the save', () => {
    service.save({ banner: { source: 'default' } }).subscribe();
    localStorage.clear();
    http.expectOne(`${api}/profile`).flush({ user: { userId: 'u1', bannerImage: '' }, token: 'new-token' });

    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('refresh() merges the saved profile into the stored user', () => {
    service.refresh().subscribe();
    http.expectOne(`${api}/profile`).flush({
      user: { userId: 'u1', bannerImage: '/assets/profile/banners/aurora.svg', bannerSource: 'preset' },
    });
    expect(service.user?.bannerImage).toBe('/assets/profile/banners/aurora.svg');
    expect(service.user?.name).toBe('Ada');
  });
});
