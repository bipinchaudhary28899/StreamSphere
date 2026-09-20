import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { UserProfileComponent } from './user-profile.component';
import { environment } from '../../../environments/environment';

describe('UserProfileComponent', () => {
  let component: UserProfileComponent;
  let fixture: ComponentFixture<UserProfileComponent>;

  beforeEach(async () => {
    localStorage.setItem('user', JSON.stringify({ userId: 'u1', name: 'Test', email: 'test@test.com' }));

    await TestBed.configureTestingModule({
      imports: [UserProfileComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the saved banner once the profile loads', () => {
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${environment.apiUrl}/profile`).flush({
      user: { userId: 'u1', bannerSource: 'preset', bannerImage: '/assets/profile/banners/ocean.svg' },
    });
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.channel-banner-img') as HTMLImageElement;
    expect(banner.getAttribute('src')).toBe('/assets/profile/banners/ocean.svg');
  });

  it('shows a new avatar on your own video cards without reloading them', () => {
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${environment.apiUrl}/videos/mine`).flush([
      { _id: 'v1', user_id: 'u1', title: 'Mine', user_profile_image: 'https://old/a.jpg' },
    ]);
    http.expectOne(`${environment.apiUrl}/profile`).flush({
      user: { userId: 'u1', profileImage: '/assets/profile/avatars/pulse.svg', avatarSource: 'preset' },
    });

    expect(component.mine.items[0].user_profile_image).toBe('/assets/profile/avatars/pulse.svg');
  });

  it('labels the picture and banner edit controls', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[aria-label="Change profile picture"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Edit banner"]')).not.toBeNull();
  });
});
