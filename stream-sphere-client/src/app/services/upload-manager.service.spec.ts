import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { UploadManagerService, UploadRequest } from './upload-manager.service';
import { PartUrl, UploadService } from './upload.service';
import { UploadStatusService } from './upload-status.service';
import { AuthService } from './auth.service';

describe('UploadManagerService', () => {
  let manager: UploadManagerService;
  let upload: jasmine.SpyObj<UploadService>;
  let ready$: BehaviorSubject<string | null>;
  let processing$: BehaviorSubject<{ id: string; title: string }[]>;
  let loggedIn$: BehaviorSubject<boolean>;
  let track: jasmine.Spy;

  const request = (title = 'Monsoon in Munnar'): UploadRequest => ({
    file: new File([new Uint8Array(2048)], 'clip.mp4', { type: 'video/mp4' }),
    title,
    description: 'Rain over the hills',
    durationSec: 65,
    facts: { name: 'clip.mp4', size: '2 KB', length: '1:05', resolution: '1920 × 1080', format: 'MP4' },
    poster: null,
  });

  /** A stand-in: dispatching a real beforeunload makes Karma think the page reloaded. */
  const unloadEvent = () =>
    ({ preventDefault: jasmine.createSpy('preventDefault'), returnValue: undefined }) as unknown as BeforeUnloadEvent & { preventDefault: jasmine.Spy };

  /** Lets the pipeline's promises settle. */
  const settle = () => new Promise(resolve => setTimeout(resolve));

  const session = () => of({ uploadId: 'u1', key: 'k1', cloudFrontUrl: 'https://cdn/raw.mp4' });

  /** A part upload that reports full progress and completes at once. */
  const instantPart = (_url: string, blob: Blob, onProgress: (loaded: number, total: number) => void) =>
    new Observable<void>(observer => {
      onProgress(blob.size, blob.size);
      observer.next();
      observer.complete();
    });

  /** Stubs every step so an upload runs to 'processing'. */
  const stubHappyPath = () => {
    upload.startMultipartUpload.and.returnValue(session());
    upload.getPartUrls.and.returnValue(of({ parts: [{ partNumber: 1, url: 'https://s3/part-1' }] }));
    upload.uploadPart.and.callFake(instantPart);
    upload.completeMultipartUpload.and.returnValue(of({ success: true }));
    upload.saveVideoMetadata.and.returnValue(of({ video: { _id: 'v1' } }));
  };

  beforeEach(() => {
    upload = jasmine.createSpyObj<UploadService>('UploadService', [
      'startMultipartUpload', 'getPartUrls', 'uploadPart',
      'completeMultipartUpload', 'abortMultipartUpload', 'saveVideoMetadata',
    ]);
    upload.abortMultipartUpload.and.returnValue(of({}));
    ready$ = new BehaviorSubject<string | null>(null);
    processing$ = new BehaviorSubject<{ id: string; title: string }[]>([]);
    loggedIn$ = new BehaviorSubject(true);
    track = jasmine.createSpy('track');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UploadService, useValue: upload },
        { provide: UploadStatusService, useValue: { track, ready$, processing$ } },
        { provide: AuthService, useValue: { getLoginState: () => loggedIn$ } },
      ],
    });
    manager = TestBed.inject(UploadManagerService);
  });

  it('uploads, saves the details and follows processing until the video is ready', async () => {
    stubHappyPath();

    const id = manager.start(request());
    expect(manager.isTransferring).toBeTrue();
    await settle();

    expect(upload.saveVideoMetadata).toHaveBeenCalledWith(jasmine.objectContaining({
      title: 'Monsoon in Munnar',
      description: 'Rain over the hills',
      S3_url: 'https://cdn/raw.mp4',
      fileSizeBytes: 2048,
      durationSec: 65,
    }));
    expect(track).toHaveBeenCalledWith('v1', 'Monsoon in Munnar');
    expect(manager.jobById(id)?.phase).toBe('processing');
    expect(manager.jobById(id)?.videoId).toBe('v1');
    expect(manager.isTransferring).toBeFalse();

    ready$.next('v1');
    expect(manager.jobById(id)?.phase).toBe('ready');
  });

  describe('while uploading', () => {
    let partUrls: Subject<{ parts: PartUrl[] }>;
    let id: string;

    beforeEach(() => {
      partUrls = new Subject();
      upload.startMultipartUpload.and.returnValue(session());
      upload.getPartUrls.and.returnValue(partUrls);
      id = manager.start(request());
    });

    it('reports progress without emitting on every tick', () => {
      const phases: string[][] = [];
      manager.jobs$.subscribe(jobs => phases.push(jobs.map(j => j.phase)));
      expect(phases).toEqual([['uploading']]);
      expect(manager.describeTransfer(manager.active!)).toBe('0 B of 2 KB');
    });

    it('queues a second video and starts it when the first finishes', async () => {
      const second = manager.start(request('Street food in Old Delhi'));
      expect(manager.jobById(second)?.phase).toBe('queued');
      expect(manager.waiting.length).toBe(1);
      expect(upload.startMultipartUpload).toHaveBeenCalledTimes(1);

      // Let the first one run to the end
      stubHappyPath();
      partUrls.next({ parts: [{ partNumber: 1, url: 'https://s3/part-1' }] });
      await settle();

      expect(manager.jobById(id)?.phase).toBe('processing');
      expect(manager.jobById(second)?.phase).toBe('processing');
      expect(upload.startMultipartUpload).toHaveBeenCalledTimes(2);
      expect(manager.jobs.length).toBe(2);
    });

    it('stops, aborts the session and keeps the details for a retry', async () => {
      manager.cancel();
      await settle();

      expect(partUrls.observed).toBeFalse();
      expect(upload.abortMultipartUpload).toHaveBeenCalledWith('k1', 'u1');
      expect(manager.jobById(id)?.phase).toBe('cancelled');
      expect(manager.jobById(id)?.title).toBe('Monsoon in Munnar');

      upload.getPartUrls.and.returnValue(new Subject());
      manager.retry(id);
      expect(manager.jobById(id)?.phase).toBe('uploading');
      expect(upload.startMultipartUpload).toHaveBeenCalledTimes(2);
    });

    it('drops a queued video without any request', () => {
      const second = manager.start(request('Waiting one'));
      manager.cancel(second);
      expect(manager.jobById(second)?.phase).toBe('cancelled');
      expect(manager.jobById(id)?.phase).toBe('uploading');
      expect(upload.startMultipartUpload).toHaveBeenCalledTimes(1);
    });

    it('asks before the tab closes', () => {
      const event = unloadEvent();
      (manager as any).onBeforeUnload(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('stops and forgets uploads when the user signs out', async () => {
      loggedIn$.next(false);
      await settle();
      expect(upload.abortMultipartUpload).toHaveBeenCalledWith('k1', 'u1');
      expect(manager.jobs).toEqual([]);
    });
  });

  it('aborts the session once it exists when stopped before it was created', () => {
    const start = new Subject<{ uploadId: string; key: string; cloudFrontUrl: string }>();
    upload.startMultipartUpload.and.returnValue(start);

    const id = manager.start(request());
    manager.cancel();
    expect(manager.jobById(id)?.phase).toBe('cancelled');

    start.next({ uploadId: 'u9', key: 'k9', cloudFrontUrl: 'https://cdn/raw.mp4' });
    expect(upload.abortMultipartUpload).toHaveBeenCalledWith('k9', 'u9');
    expect(upload.getPartUrls).not.toHaveBeenCalled();
  });

  it('reports a failed upload and lets it be dismissed', async () => {
    upload.startMultipartUpload.and.returnValue(session());
    upload.getPartUrls.and.returnValue(of({ parts: [{ partNumber: 1, url: 'https://s3/part-1' }] }));
    upload.uploadPart.and.returnValue(new Observable<void>(observer => observer.error(new Error('network'))));

    const id = manager.start(request());
    await settle();

    expect(upload.abortMultipartUpload).toHaveBeenCalledWith('k1', 'u1');
    expect(manager.jobById(id)?.phase).toBe('failed');
    expect(manager.jobById(id)?.error).toContain('didn’t finish');
    expect(manager.hasFailed).toBeTrue();
    expect(manager.hasActivity).toBeTrue();

    manager.dismiss(id);
    expect(manager.jobs).toEqual([]);
  });

  it('starts the next video when one fails', async () => {
    upload.startMultipartUpload.and.returnValue(session());
    upload.getPartUrls.and.returnValue(of({ parts: [{ partNumber: 1, url: 'https://s3/part-1' }] }));
    upload.uploadPart.and.returnValue(new Observable<void>(observer => observer.error(new Error('network'))));

    manager.start(request('First'));
    const second = manager.start(request('Second'));
    await settle();

    expect(manager.jobs[0].phase).toBe('failed');
    expect(manager.jobById(second)?.phase).toBe('failed'); // it tried too, with the same stub
    expect(upload.startMultipartUpload).toHaveBeenCalledTimes(2);
  });

  it('does not ask before the tab closes when nothing is uploading', () => {
    const event = unloadEvent();
    (manager as any).onBeforeUnload(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('counts videos that are still processing', () => {
    processing$.next([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
    expect(manager.processingCount).toBe(2);
    expect(manager.hasActivity).toBeTrue();
  });
});
