import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { HeaderComponent } from './header.component';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the saved banner behind the user menu card', () => {
    localStorage.setItem('user', JSON.stringify({
      userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.com',
      bannerImage: '/assets/profile/banners/noir.svg',
    }));
    component.loadUserData();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.avatar-btn').click();
    fixture.detectChanges();

    const strip = document.querySelector('.menu-banner-strip') as HTMLElement;
    expect(strip.classList).toContain('has-image');
    expect(strip.querySelector('img.menu-banner')?.getAttribute('src')).toBe('/assets/profile/banners/noir.svg');
  });

  it('keeps the default gradient strip when no banner is set', () => {
    localStorage.setItem('user', JSON.stringify({ userId: 'u1', name: 'Ada', email: 'ada@example.com' }));
    component.loadUserData();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.avatar-btn').click();
    fixture.detectChanges();

    const strip = document.querySelector('.menu-banner-strip') as HTMLElement;
    expect(strip.classList).not.toContain('has-image');
    expect(strip.querySelector('img.menu-banner')).toBeNull();
  });
});
