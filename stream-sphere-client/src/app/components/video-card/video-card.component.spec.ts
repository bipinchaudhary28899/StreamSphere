import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { VideoCardComponent } from './video-card.component';

describe('VideoCardComponent', () => {
  let component: VideoCardComponent;
  let fixture: ComponentFixture<VideoCardComponent>;
  let router: Router;

  const mockVideo = {
    _id: 'vid1',
    title: 'Test Video',
    description: 'A test description',
    S3_url: 'https://cdn.example.com/video.mp4',
    user_id: 'user1',
    userName: 'TestUser',
    user_profile_image: 'https://cdn.example.com/avatar.jpg',
    likes: 42,
    views: 1500,
    category: 'Education',
  };

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [VideoCardComponent, NoopAnimationsModule],
      providers: [provideRouter([])],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(VideoCardComponent);
    component = fixture.componentInstance;
    // Do NOT call detectChanges here — tests set @Input() video first
  });

  afterEach(() => localStorage.clear());

  // ── Creation ─────────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ── ngOnInit() ────────────────────────────────────────────────────────────────

  describe('ngOnInit()', () => {
    it('should log an error and return early when no video is provided', () => {
      spyOn(console, 'error');
      // Call ngOnInit directly — detectChanges() would crash the template
      // because the HTML has {{ video.likes }} without safe-navigation
      component.ngOnInit();
      expect(console.error).toHaveBeenCalledWith(
        'No video data provided to video card component',
      );
    });

    it('should set isOwner = true when the logged-in user owns the video', () => {
      localStorage.setItem('user', JSON.stringify({ userId: 'user1' }));
      component.video = mockVideo;
      fixture.detectChanges();
      expect(component.isOwner).toBeTrue();
    });

    it('should set isOwner = false when another user is logged in', () => {
      localStorage.setItem('user', JSON.stringify({ userId: 'other-user' }));
      component.video = mockVideo;
      fixture.detectChanges();
      expect(component.isOwner).toBeFalse();
    });

    it('should set currentUserId from localStorage', () => {
      localStorage.setItem('user', JSON.stringify({ userId: 'user1' }));
      component.video = mockVideo;
      fixture.detectChanges();
      expect(component.currentUserId).toBe('user1');
    });

    it('should set currentUserId = null when no user in localStorage', () => {
      component.video = mockVideo;
      fixture.detectChanges();
      expect(component.currentUserId).toBeNull();
    });

    it('should sanitize the S3_url and set safeUrl', () => {
      component.video = mockVideo;
      fixture.detectChanges();
      // DomSanitizer wraps the value — just verify it is truthy
      expect(component.safeUrl).toBeTruthy();
    });
  });

  // ── @Input defaults ────────────────────────────────────────────────────────

  describe('@Input() defaults', () => {
    it('should default flipEnabled to true', () => {
      expect(component.flipEnabled).toBeTrue();
    });

    it('should default faded to false', () => {
      expect(component.faded).toBeFalse();
    });
  });

  // ── onVideoClick() ────────────────────────────────────────────────────────────

  describe('onVideoClick()', () => {
    it('should navigate to /video/:id when the video has an _id', () => {
      component.video = mockVideo;
      fixture.detectChanges();
      spyOn(router, 'navigate');

      component.onVideoClick();

      expect(router.navigate).toHaveBeenCalledWith(['/video', 'vid1']);
    });

    it('should NOT navigate when video is undefined', () => {
      // Render with valid video first to avoid template crash on video.likes
      component.video = mockVideo;
      fixture.detectChanges();
      spyOn(router, 'navigate');

      // Then set video to undefined and test the method directly
      component.video = undefined;
      component.onVideoClick();

      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('should NOT navigate when video has no _id', () => {
      component.video = { ...mockVideo, _id: undefined };
      fixture.detectChanges();
      spyOn(router, 'navigate');

      component.onVideoClick();

      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  // ── onFlipClick() ─────────────────────────────────────────────────────────────

  describe('onFlipClick()', () => {
    beforeEach(() => {
      component.video = mockVideo;
      fixture.detectChanges();
    });

    it('should toggle flip from false to true', () => {
      expect(component.flip).toBeFalse();
      component.onFlipClick(new MouseEvent('click'));
      expect(component.flip).toBeTrue();
    });

    it('should toggle flip back to false on the second call', () => {
      component.onFlipClick(new MouseEvent('click'));
      component.onFlipClick(new MouseEvent('click'));
      expect(component.flip).toBeFalse();
    });

    it('should stop event propagation to prevent navigation', () => {
      const event = new MouseEvent('click');
      spyOn(event, 'stopPropagation');
      component.onFlipClick(event);
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });

  // ── onDeleteClick() ───────────────────────────────────────────────────────────

  describe('onDeleteClick()', () => {
    beforeEach(() => {
      localStorage.setItem('user', JSON.stringify({ userId: 'user1' }));
      component.video = mockVideo;
      fixture.detectChanges();
    });

    it('should emit videoDeleted with the video _id when user confirms', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      let deletedId: string | undefined;
      component.videoDeleted.subscribe((id: string) => (deletedId = id));

      component.onDeleteClick(new MouseEvent('click'));

      expect(deletedId).toBe('vid1');
    });

    it('should NOT emit videoDeleted when user cancels the confirm dialog', () => {
      spyOn(window, 'confirm').and.returnValue(false);
      let emitted = false;
      component.videoDeleted.subscribe(() => (emitted = true));

      component.onDeleteClick(new MouseEvent('click'));

      expect(emitted).toBeFalse();
    });

    it('should stop event propagation', () => {
      spyOn(window, 'confirm').and.returnValue(false);
      const event = new MouseEvent('click');
      spyOn(event, 'stopPropagation');

      component.onDeleteClick(event);

      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('should show a confirmation dialog before deleting', () => {
      spyOn(window, 'confirm').and.returnValue(false);
      component.onDeleteClick(new MouseEvent('click'));
      expect(window.confirm).toHaveBeenCalled();
    });
  });

  // ── deleteVideo() ─────────────────────────────────────────────────────────────

  describe('deleteVideo()', () => {
    it('should emit videoDeleted with the video _id', () => {
      localStorage.setItem('user', JSON.stringify({ userId: 'user1' }));
      component.video = mockVideo;
      fixture.detectChanges();

      let emittedId: string | undefined;
      component.videoDeleted.subscribe((id: string) => (emittedId = id));

      component.deleteVideo();

      expect(emittedId).toBe('vid1');
    });

    it('should NOT emit when currentUserId is null (not logged in)', () => {
      component.video = mockVideo;
      fixture.detectChanges(); // no user in localStorage → currentUserId = null

      let emitted = false;
      component.videoDeleted.subscribe(() => (emitted = true));

      component.deleteVideo();

      expect(emitted).toBeFalse();
    });

    it('should NOT emit when video has no _id', () => {
      localStorage.setItem('user', JSON.stringify({ userId: 'user1' }));
      component.video = { ...mockVideo, _id: undefined };
      fixture.detectChanges();

      let emitted = false;
      component.videoDeleted.subscribe(() => (emitted = true));

      component.deleteVideo();

      expect(emitted).toBeFalse();
    });
  });

  // ── onAvatarError() ───────────────────────────────────────────────────────────

  describe('onAvatarError()', () => {
    it('should hide the broken avatar image', () => {
      component.video = mockVideo;
      fixture.detectChanges();

      const img = document.createElement('img');
      img.style.display = 'block';
      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: img, writable: false });

      component.onAvatarError(event);

      expect(img.style.display).toBe('none');
    });
  });

  // ── formatViews() ─────────────────────────────────────────────────────────────

  describe('formatViews()', () => {
    it('should return "0" for a count of zero', () => {
      expect(component.formatViews(0)).toBe('0');
    });

    it('should return "0" for a falsy value', () => {
      expect(component.formatViews(null as any)).toBe('0');
    });

    it('should format 1,000 as "1K"', () => {
      expect(component.formatViews(1_000)).toBe('1K');
    });

    it('should format 1,500 as "1.5K"', () => {
      expect(component.formatViews(1_500)).toBe('1.5K');
    });

    it('should format 10,000 as "10K"', () => {
      expect(component.formatViews(10_000)).toBe('10K');
    });

    it('should strip trailing ".0" from K values', () => {
      expect(component.formatViews(2_000)).toBe('2K');
      expect(component.formatViews(50_000)).toBe('50K');
    });

    it('should format 1,000,000 as "1M"', () => {
      expect(component.formatViews(1_000_000)).toBe('1M');
    });

    it('should format 2,500,000 as "2.5M"', () => {
      expect(component.formatViews(2_500_000)).toBe('2.5M');
    });

    it('should strip trailing ".0" from M values', () => {
      expect(component.formatViews(5_000_000)).toBe('5M');
    });

    it('should format values below 1,000 as plain locale strings', () => {
      expect(component.formatViews(999)).toBe('999');
      expect(component.formatViews(100)).toBe('100');
      expect(component.formatViews(1)).toBe('1');
    });
  });
});
