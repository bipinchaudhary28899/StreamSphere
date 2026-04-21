import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(() => {
    localStorage.clear();
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        AuthGuard,
        { provide: Router, useValue: routerSpy },
      ],
    });

    guard = TestBed.inject(AuthGuard);
  });

  afterEach(() => localStorage.clear());

  it('should be created', () => {
    expect(guard).toBeTruthy();
  });

  it('should allow activation if user is logged in', () => {
    localStorage.setItem('token', 'jwt-token');
    localStorage.setItem('user', JSON.stringify({ userId: 'user1', name: 'Test' }));
    expect(guard.canActivate()).toBeTrue();
  });

  it('should prevent activation and navigate to /home if user is not logged in', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    expect(guard.canActivate()).toBeFalse();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/home'], { replaceUrl: true });
  });

  it('should prevent activation when token is missing even if user data exists', () => {
    localStorage.removeItem('token');
    localStorage.setItem('user', JSON.stringify({ userId: 'user1' }));
    expect(guard.canActivate()).toBeFalse();
  });

  it('should prevent activation when user JSON is malformed', () => {
    localStorage.setItem('token', 'jwt-token');
    localStorage.setItem('user', 'not-valid-json');
    expect(guard.canActivate()).toBeFalse();
  });
});
