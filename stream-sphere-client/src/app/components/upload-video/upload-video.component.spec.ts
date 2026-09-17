import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { UploadVideoComponent } from './upload-video.component';
import { PartUrl, UploadService } from '../../services/upload.service';
import { UploadStatusService } from '../../services/upload-status.service';
import { UploadManagerService } from '../../services/upload-manager.service';
import { AuthService } from '../../services/auth.service';

describe('UploadVideoComponent', () => {
  let component: UploadVideoComponent;
  let fixture: ComponentFixture<UploadVideoComponent>;
  let manager: UploadManagerService;
  let upload: jasmine.SpyObj<UploadService>;
  let ready$: BehaviorSubject<string | null>;
  let processing$: BehaviorSubject<{ id: string; title: string }[]>;

  // jsdom has no object URLs
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;

  const video = (name = 'clip.mp4', size = 1024) =>
    new File([new Uint8Array(size)], name, { type: 'video/mp4' });

  /** Selects a file as if the browser had read its metadata. */
  const select = (file: File) =>
    (component as any).acceptFile(file, { duration: 65, width: 1920, height: 1080, poster: null });

  /** Lets the upload pipeline's promises settle. */
  const settle = () => new Promise(resolve => setTimeout(resolve));

  const createPage = () => {
    fixture = TestBed.createComponent(UploadVideoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    (URL as any).createObjectURL = () => 'blob:preview';
    (URL as any).revokeObjectURL = () => {};

    upload = jasmine.createSpyObj<UploadService>('UploadService', [
      'startMultipartUpload', 'getPartUrls', 'uploadPart',
      'completeMultipartUpload', 'abortMultipartUpload', 'saveVideoMetadata',
    ]);
    upload.abortMultipartUpload.and.returnValue(of({}));
    upload.startMultipartUpload.and.returnValue(of({ uploadId: 'u1', key: 'k1', cloudFrontUrl: 'https://cdn/raw.mp4' }));
    ready$ = new BehaviorSubject<string | null>(null);
    processing$ = new BehaviorSubject<{ id: string; title: string }[]>([]);

    await TestBed.configureTestingModule({
      imports: [UploadVideoComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: UploadService, useValue: upload },
        { provide: UploadStatusService, useValue: { track: () => {}, recover: () => {}, ready$, processing$ } },
        { provide: AuthService, useValue: { getLoginState: () => of(true) } },
      ],
    }).compileComponents();

    manager = TestBed.inject(UploadManagerService);
    createPage();
  });

  afterEach(() => {
    (URL as any).createObjectURL = realCreate;
    (URL as any).revokeObjectURL = realRevoke;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('choosing a file', () => {
    it('rejects files that are not videos', () => {
      (component as any).handleFile(new File(['x'], 'notes.txt', { type: 'text/plain' }));
      expect(component.errorMessage).toContain('isn’t a video');
      expect(component.selectedFile).toBeNull();
    });

    it('rejects empty files', () => {
      (component as any).handleFile(new File([], 'empty.mp4', { type: 'video/mp4' }));
      expect(component.errorMessage).toContain('is empty');
      expect(component.selectedFile).toBeNull();
    });

    it('lists the file facts and suggests a title from the file name', () => {
      select(video('goa_sunset-final.mp4', 3 * 1024 * 1024));
      expect(component.facts).toEqual({
        name: 'goa_sunset-final.mp4',
        size: '3.0 MB',
        length: '1:05',
        resolution: '1920 × 1080',
        format: 'MP4',
      });
      expect(component.previewUrl).toBe('blob:preview');
      expect(component.uploadForm.get('title')?.value).toBe('goa sunset final');
    });

    it('updates a suggested title when the file is replaced', () => {
      select(video('first_take.mp4'));
      select(video('second-take.mp4'));
      expect(component.uploadForm.get('title')?.value).toBe('second take');
    });

    it('keeps a title the user wrote', () => {
      component.uploadForm.get('title')?.setValue('My trip');
      select(video('IMG_0042.mp4'));
      expect(component.uploadForm.get('title')?.value).toBe('My trip');
    });

    it('clears everything when the file is removed', () => {
      select(video());
      component.removeFile();
      expect(component.selectedFile).toBeNull();
      expect(component.facts).toBeNull();
      expect(component.previewUrl).toBeNull();
    });
  });

  it('does not upload without a title', () => {
    select(video());
    component.uploadForm.get('title')?.setValue('');
    component.onSubmit();
    expect(component.showTitleError).toBeTrue();
    expect(upload.startMultipartUpload).not.toHaveBeenCalled();
  });

  describe('while uploading', () => {
    let partUrls: Subject<{ parts: PartUrl[] }>;

    beforeEach(() => {
      partUrls = new Subject();
      upload.getPartUrls.and.returnValue(partUrls);
      select(video());
      component.uploadForm.patchValue({ title: 'Monsoon in Munnar' });
      component.onSubmit();
    });

    it('hands the upload to the background service and locks the form', () => {
      expect(manager.active?.phase).toBe('uploading');
      expect(manager.active?.title).toBe('Monsoon in Munnar');
      expect(component.uploadPhase).toBe('uploading');
      expect(component.uploadForm.disabled).toBeTrue();
      expect(component.stepState(1)).toBe('current');
    });

    it('keeps uploading after the page is left, and shows it again on return', () => {
      fixture.destroy();
      expect(manager.active?.phase).toBe('uploading');
      expect(partUrls.observed).toBeTrue();

      createPage();
      expect(component.selectedFile?.name).toBe('clip.mp4');
      expect(component.uploadForm.getRawValue().title).toBe('Monsoon in Munnar');
      expect(component.uploadForm.disabled).toBeTrue();
      expect(component.uploadPhase).toBe('uploading');
    });

    it('stops the upload from the page', async () => {
      component.cancelUpload();
      await settle();

      expect(partUrls.observed).toBeFalse();
      expect(upload.abortMultipartUpload).toHaveBeenCalledWith('k1', 'u1');
      expect(component.uploadPhase).toBe('idle');
      expect(component.uploadForm.enabled).toBeTrue();
      expect(component.selectedFile).not.toBeNull();
      expect(component.noticeMessage).toContain('Upload stopped');
    });
  });

  it('shows the finished upload and follows processing', async () => {
    upload.getPartUrls.and.returnValue(of({ parts: [{ partNumber: 1, url: 'https://s3/part-1' }] }));
    upload.uploadPart.and.callFake((_url: string, blob: Blob, onProgress: (loaded: number, total: number) => void) =>
      new Observable<void>(observer => {
        onProgress(blob.size, blob.size);
        observer.next();
        observer.complete();
      }));
    upload.completeMultipartUpload.and.returnValue(of({ success: true }));
    upload.saveVideoMetadata.and.returnValue(of({ video: { _id: 'v1' } }));

    select(video());
    component.uploadForm.patchValue({ title: 'Monsoon in Munnar' });
    component.onSubmit();
    await settle();

    expect(component.uploadPhase).toBe('success');
    expect(component.stepState(1)).toBe('done');
    expect(component.stepState(2)).toBe('current');

    ready$.next('v1');
    expect(component.isReady).toBeTrue();
    expect(component.stepState(3)).toBe('done');

    component.uploadAnother();
    expect(component.uploadPhase).toBe('idle');
    expect(component.selectedFile).toBeNull();
    expect(component.uploadForm.get('title')?.value).toBe('');
    // The finished upload keeps its place in the list
    expect(manager.jobs.length).toBe(1);
    expect(component.otherUploads.map(item => item.job?.title)).toEqual(['Monsoon in Munnar']);
  });

  it('shows a failed upload with its details so it can be tried again', async () => {
    upload.getPartUrls.and.returnValue(of({ parts: [{ partNumber: 1, url: 'https://s3/part-1' }] }));
    upload.uploadPart.and.returnValue(new Observable<void>(observer => observer.error(new Error('network'))));

    select(video());
    component.uploadForm.patchValue({ title: 'Monsoon in Munnar' });
    component.onSubmit();
    await settle();

    expect(component.uploadPhase).toBe('idle');
    expect(component.errorMessage).toContain('didn’t finish');
    expect(component.uploadForm.enabled).toBeTrue();
    expect(component.selectedFile).not.toBeNull();
    expect(component.uploadForm.get('title')?.value).toBe('Monsoon in Munnar');
  });

  it('lists other videos that are still processing', () => {
    processing$.next([{ id: 'old', title: 'Earlier upload' }]);
    expect(component.otherUploads.length).toBe(1);
    expect(component.rowTitle(component.otherUploads[0])).toBe('Earlier upload');
    expect(component.rowStatus(component.otherUploads[0])).toBe('Processing');

    ready$.next('old');
    expect(component.rowStatus(component.otherUploads[0])).toBe('Ready to watch');
    expect(component.rowWatchId(component.otherUploads[0])).toBe('old');
  });

  it('queues a second upload and shows its status in the list', () => {
    upload.getPartUrls.and.returnValue(new Subject());
    select(video('first.mp4'));
    component.uploadForm.patchValue({ title: 'First' });
    component.onSubmit();

    // Start another from the same page
    component.uploadAnother();
    select(video('second.mp4'));
    component.uploadForm.patchValue({ title: 'Second' });
    component.onSubmit();

    expect(component.isQueued).toBeTrue();
    expect(component.uploadPhase).toBe('idle');
    expect(component.noticeMessage).toContain('Waiting');
    expect(component.otherUploads.length).toBe(1);
    expect(component.rowStatus(component.otherUploads[0])).toContain('Uploading');
  });
});
