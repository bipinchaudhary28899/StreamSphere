import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { UploadIndicatorComponent } from './upload-indicator.component';
import { UploadJob, UploadJobPhase, UploadManagerService } from '../../services/upload-manager.service';
import { UploadStatusService } from '../../services/upload-status.service';

@Component({ standalone: true, template: '' })
class BlankPage {}

describe('UploadIndicatorComponent', () => {
  let fixture: ComponentFixture<UploadIndicatorComponent>;
  let component: UploadIndicatorComponent;
  let jobs$: BehaviorSubject<UploadJob[]>;
  let processing$: BehaviorSubject<{ id: string; title: string }[]>;
  let ready$: BehaviorSubject<string | null>;
  let recover: jasmine.Spy;
  let router: Router;

  const job = (phase: UploadJobPhase, title = 'Monsoon in Munnar', id = 'upload-1'): UploadJob => ({
    id,
    file: new File([new Uint8Array(4096)], 'clip.mp4', { type: 'video/mp4' }),
    title,
    description: '',
    durationSec: 65,
    facts: { name: 'clip.mp4', size: '4 KB', length: '1:05', resolution: '', format: 'MP4' },
    poster: null,
    phase,
    progress: 42,
    uploadedBytes: 1024,
    bytesPerSecond: 0,
    videoId: phase === 'ready' || phase === 'processing' ? `v-${id}` : null,
    error: '',
  });

  const card = () => fixture.nativeElement.querySelector('.upc') as HTMLElement | null;

  const cards = () => Array.from(fixture.nativeElement.querySelectorAll('.upc')) as HTMLElement[];

  const show = (phase: UploadJobPhase | null) => {
    jobs$.next(phase ? [job(phase)] : []);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    jobs$ = new BehaviorSubject<UploadJob[]>([]);
    processing$ = new BehaviorSubject<{ id: string; title: string }[]>([]);
    ready$ = new BehaviorSubject<string | null>(null);
    recover = jasmine.createSpy('recover');
    const uploads = {
      jobs$,
      get jobs() { return jobs$.value; },
      get active() { return jobs$.value.find(j => j.phase === 'uploading' || j.phase === 'saving') ?? null; },
      get isTransferring() { return !!this.active; },
    };

    await TestBed.configureTestingModule({
      imports: [UploadIndicatorComponent],
      providers: [
        provideRouter([
          { path: 'home', component: BlankPage },
          { path: 'upload', component: BlankPage },
          { path: 'history', component: BlankPage },
        ]),
        { provide: UploadManagerService, useValue: uploads },
        { provide: UploadStatusService, useValue: { recover, processing$, ready$ } },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    await router.navigateByUrl('/history');
    fixture = TestBed.createComponent(UploadIndicatorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => document.body.classList.remove('ss-has-upload-card'));

  it('stays hidden when nothing is uploading', () => {
    expect(card()).toBeNull();
    expect(document.body.classList.contains('ss-has-upload-card')).toBeFalse();
  });

  it('follows an upload with a link back to the upload page', () => {
    show('uploading');
    expect(card()?.textContent).toContain('Uploading · 42%');
    expect(card()?.textContent).toContain('Monsoon in Munnar');
    expect(card()?.querySelector('a')?.getAttribute('href')).toBe('/upload');
    expect(document.body.classList.contains('ss-has-upload-card')).toBeTrue();
  });

  it('is not shown on the upload page itself', async () => {
    show('uploading');
    await router.navigateByUrl('/upload');
    fixture.detectChanges();
    expect(card()).toBeNull();
  });

  it('stays on screen while a video is processing, including on home', async () => {
    await router.navigateByUrl('/home');
    show('processing');
    expect(card()?.textContent).toContain('Uploaded · processing');

    show('uploading');
    expect(card()?.textContent).toContain('Uploading');
  });

  it('offers to watch the video once it is ready', () => {
    show('ready');
    expect(card()?.textContent).toContain('Ready to watch');
    expect(card()?.querySelector('a')?.getAttribute('href')).toBe('/video/v-upload-1');
  });

  it('shows one card per upload', () => {
    jobs$.next([job('processing', 'First', 'upload-1'), job('uploading', 'Second', 'upload-2')]);
    fixture.detectChanges();

    const texts = cards().map(c => c.textContent ?? '');
    expect(texts.length).toBe(2);
    expect(texts[0]).toContain('Second');   // newest first
    expect(texts[0]).toContain('Uploading');
    expect(texts[1]).toContain('First');
    expect(texts[1]).toContain('processing');
  });

  it('shows a queued upload as waiting', () => {
    show('queued');
    expect(card()?.textContent).toContain('Waiting to upload');
  });

  it('can be hidden until the next change', () => {
    show('uploading');
    component.hide(component.items[0]);
    fixture.detectChanges();
    expect(card()).toBeNull();

    show('failed');
    expect(card()?.textContent).toContain('Upload failed');
  });

  it('does not show a stopped upload', () => {
    show('cancelled');
    expect(card()).toBeNull();
  });

  describe('without an upload in this tab (e.g. after a refresh)', () => {
    it('asks the tracker for videos still processing', () => {
      expect(recover).toHaveBeenCalled();
    });

    it('shows a video that is still processing, with a link to the upload page', () => {
      processing$.next([{ id: 'old', title: 'Earlier upload' }]);
      fixture.detectChanges();
      expect(card()?.textContent).toContain('Processing');
      expect(card()?.textContent).toContain('Earlier upload');
      expect(card()?.querySelector('a')?.getAttribute('href')).toBe('/upload');
    });

    it('shows a card for each processing video', () => {
      processing$.next([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
      fixture.detectChanges();
      const texts = cards().map(c => c.textContent ?? '');
      expect(texts.length).toBe(2);
      expect(texts.join(' ')).toContain('A');
      expect(texts.join(' ')).toContain('B');
      expect(texts.every(t => t.includes('Processing'))).toBeTrue();
    });

    it('offers to watch one that finishes processing', () => {
      processing$.next([{ id: 'old', title: 'Earlier upload' }]);
      fixture.detectChanges();
      ready$.next('old');
      fixture.detectChanges();
      expect(card()?.textContent).toContain('Ready to watch');
      expect(card()?.querySelector('a')?.getAttribute('href')).toBe('/video/old');
    });

    it('stays out of the way when nothing is processing', () => {
      processing$.next([]);
      fixture.detectChanges();
      expect(card()).toBeNull();
    });
  });
});
