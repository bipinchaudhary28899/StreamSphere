import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── Initial login state ──────────────────────────────────────────────────────

  describe('Initial login state', () => {
    it('should be false when no user in localStorage', () => {
      expect(service.isLoggedIn()).toBeFalse();
    });

    it('should be true when user exists in localStorage at construction time', () => {
      localStorage.setItem('user', JSON.stringify({ userId: '1', name: 'Test' }));

      // Re-create service so the constructor re-reads localStorage
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [HttpClientTestingModule],
        providers: [AuthService],
      });
      const freshService = TestBed.inject(AuthService);

      expect(freshService.isLoggedIn()).toBeTrue();

      // Drain the new HttpTestingController
      TestBed.inject(HttpTestingController).verify();
    });
  });

  // ── googleLogin() ────────────────────────────────────────────────────────────

  describe('googleLogin()', () => {
    it('should POST to /google-login with the provided token', () => {
      const mockResponse = { token: 'jwt123', user: { userId: '1' } };

      service.googleLogin('google-id-token').subscribe((res) => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${environment.apiUrl}/google-login`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ token: 'google-id-token' });
      req.flush(mockResponse);
    });

    it('should propagate HTTP errors to the subscriber', () => {
      let errorStatus: number | undefined;

      service.googleLogin('bad-token').subscribe({
        error: (err) => (errorStatus = err.status),
      });

      const req = httpMock.expectOne(`${environment.apiUrl}/google-login`);
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      expect(errorStatus).toBe(401);
    });
  });

  // ── getRedirectUrl() ─────────────────────────────────────────────────────────

  describe('getRedirectUrl()', () => {
    it('should return null when nothing is stored in sessionStorage', () => {
      expect(service.getRedirectUrl()).toBeNull();
    });

    it('should return the stored redirect URL from sessionStorage', () => {
      sessionStorage.setItem('redirectUrl', '/dashboard');
      expect(service.getRedirectUrl()).toBe('/dashboard');
    });
  });

  // ── getLoginState() ──────────────────────────────────────────────────────────

  describe('getLoginState()', () => {
    it('should emit the current login state immediately on subscribe', (done) => {
      service.getLoginState().subscribe((state) => {
        expect(state).toBeFalse();
        done();
      });
    });

    it('should emit updated state after updateLoginState() is called', fakeAsync(() => {
      const emitted: boolean[] = [];
      service.getLoginState().subscribe((s) => emitted.push(s));

      service.updateLoginState(true);
      tick(); // flush the internal setTimeout

      expect(emitted).toContain(true);
    }));
  });

  // ── updateLoginState() ───────────────────────────────────────────────────────

  describe('updateLoginState()', () => {
    it('should set login state to true after the deferred tick', fakeAsync(() => {
      service.updateLoginState(true);
      tick();
      expect(service.isLoggedIn()).toBeTrue();
    }));

    it('should set login state back to false after a second call', fakeAsync(() => {
      service.updateLoginState(true);
      tick();
      service.updateLoginState(false);
      tick();
      expect(service.isLoggedIn()).toBeFalse();
    }));
  });

  // ── isLoggedIn() ─────────────────────────────────────────────────────────────

  describe('isLoggedIn()', () => {
    it('should return false before any state change', () => {
      expect(service.isLoggedIn()).toBeFalse();
    });

    it('should reflect the latest state synchronously', fakeAsync(() => {
      service.updateLoginState(true);
      tick();
      expect(service.isLoggedIn()).toBeTrue();
    }));
  });

  // ── logout() ─────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('should remove "user" and "token" from localStorage', fakeAsync(() => {
      localStorage.setItem('user', JSON.stringify({ userId: '1' }));
      localStorage.setItem('token', 'jwt-token');

      service.logout();
      tick();

      expect(localStorage.getItem('user')).toBeNull();
      expect(localStorage.getItem('token')).toBeNull();
    }));

    it('should set login state to false', fakeAsync(() => {
      service.updateLoginState(true);
      tick();

      service.logout();
      tick();

      expect(service.isLoggedIn()).toBeFalse();
    }));

    it('should emit false on the login state observable', fakeAsync(() => {
      const states: boolean[] = [];
      service.getLoginState().subscribe((s) => states.push(s));

      service.updateLoginState(true);
      tick();
      service.logout();
      tick();

      expect(states[states.length - 1]).toBeFalse();
    }));
  });
});
