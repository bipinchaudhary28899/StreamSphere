// services/upload-manager.service.ts
//
// Runs multipart uploads outside any page, so people can keep browsing while
// videos upload. The upload page, the header, the bottom nav and the floating
// upload cards all read these jobs.
//
// One video transfers at a time; anything started meanwhile waits its turn.
// After the bytes are saved, UploadStatusService tracks server-side processing
// (the home feed shows its banner); this service mirrors that per job.

import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { UploadService, PartUrl } from './upload.service';
import { VideoService } from './video.service';
import { UploadStatusService } from './upload-status.service';
import { AuthService } from './auth.service';
import { formatBytes, timeLeftLabel } from '../shared/format';

/** S3 minimum part size is 5 MiB; 5 MiB gives smooth progress updates. */
const PART_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB

/** Number of parts to upload concurrently. */
const CONCURRENCY = 4;

export type UploadJobPhase =
  | 'queued'      // waiting for the video ahead of it
  | 'uploading'   // bytes are moving; can be stopped
  | 'saving'      // completing the upload and saving details; can't be stopped
  | 'processing'  // saved; the backend is preparing the streams
  | 'ready'       // live in the feed
  | 'failed'
  | 'cancelled';

/** What the browser could read from the file, for display. */
export interface UploadFileFacts {
  name: string;
  size: string;
  length: string;      // '' when unknown
  resolution: string;  // '' when unknown
  format: string;
}

export interface UploadRequest {
  file: File;
  title: string;
  description: string;
  /** Seconds, 0 when the browser couldn't read it */
  durationSec: number;
  facts: UploadFileFacts;
  /** JPEG data URL of an early frame, if one could be captured */
  poster: string | null;
}

export interface UploadJob extends UploadRequest {
  /** Identifies this job for as long as the tab lives */
  id: string;
  phase: UploadJobPhase;
  /** progress, uploadedBytes and bytesPerSecond change in place while uploading */
  progress: number;
  uploadedBytes: number;
  bytesPerSecond: number;
  videoId: string | null;
  /** Set when phase is 'failed' */
  error: string;
}

/** Thrown inside the pipeline when the user stops an upload. */
class UploadCancelled extends Error {
  constructor() { super('Upload cancelled'); }
}

/** One upload attempt, so it can be stopped from outside the pipeline. */
interface UploadRun {
  cancelled: boolean;
  /** Requests that are safe to abort mid-flight */
  requests: Subscription;
  /** Rejects whichever step is currently awaited */
  rejectPending?: (reason: unknown) => void;
  rateSample: { time: number; bytes: number } | null;
}

let nextJobId = 0;

@Injectable({ providedIn: 'root' })
export class UploadManagerService implements OnDestroy {

  private items: UploadJob[] = [];
  private readonly jobsSubject = new BehaviorSubject<UploadJob[]>([]);
  /** Emits when a job is added, changes phase or is dismissed — not on every progress tick. */
  readonly jobs$ = this.jobsSubject.asObservable();

  /** Videos the backend is still processing (any upload, including earlier sessions). */
  processingCount = 0;

  private runs = new Map<string, UploadRun>();
  private signedOut = false;
  private subs = new Subscription();

  /** Closing or reloading the tab would kill a transfer, so ask first. */
  private readonly onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (this.isTransferring) {
      event.preventDefault();
      event.returnValue = ''; // Chrome needs this to show its prompt
    }
  };

  constructor(
    private uploadService: UploadService,
    private videoService: VideoService,
    private uploadStatus: UploadStatusService,
    private authService: AuthService,
  ) {
    window.addEventListener('beforeunload', this.onBeforeUnload);

    this.subs.add(
      this.uploadStatus.processing$.subscribe(list => this.processingCount = list.length),
    );
    this.subs.add(
      this.uploadStatus.ready$.subscribe(id => {
        if (!id) return;
        const job = this.items.find(j => j.phase === 'processing' && j.videoId === id);
        if (job) this.patch(job, { phase: 'ready' });
      }),
    );
    // Signing out ends the session the uploads rely on. Forget them entirely so
    // the next person on this browser doesn't see them.
    this.subs.add(
      this.authService.getLoginState().subscribe(loggedIn => {
        this.signedOut = !loggedIn;
        if (loggedIn) return;
        this.items.slice().forEach(job => this.cancel(job.id));
        if (this.items.length) {
          this.items = [];
          this.emit();
        }
      }),
    );
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.subs.unsubscribe();
  }

  // ── State ───────────────────────────────────────────────────────────────────

  /** Every upload this tab knows about, oldest first. */
  get jobs(): UploadJob[] {
    return this.items;
  }

  jobById(id: string | null): UploadJob | null {
    return id ? this.items.find(job => job.id === id) ?? null : null;
  }

  /** The job whose bytes are moving right now. */
  get active(): UploadJob | null {
    return this.items.find(job => job.phase === 'uploading' || job.phase === 'saving') ?? null;
  }

  /** The most recently started job. */
  get latest(): UploadJob | null {
    return this.items.length ? this.items[this.items.length - 1] : null;
  }

  /** Bytes are still moving (the tab must stay open). */
  get isTransferring(): boolean {
    return !!this.active;
  }

  get hasFailed(): boolean {
    return this.items.some(job => job.phase === 'failed');
  }

  get waiting(): UploadJob[] {
    return this.items.filter(job => job.phase === 'queued');
  }

  /** Anything worth a status badge: a transfer, a queue, a failure or processing. */
  get hasActivity(): boolean {
    return this.isTransferring
      || this.waiting.length > 0
      || this.items.some(job => job.phase === 'failed')
      || this.processingCount > 0;
  }

  /** "6.5 MB of 21.7 MB · 2.0 MB/s · About 10 seconds left" */
  describeTransfer(job: UploadJob): string {
    const total = job.file.size;
    const parts = [`${formatBytes(job.uploadedBytes)} of ${formatBytes(total)}`];
    if (job.bytesPerSecond > 0) {
      parts.push(`${formatBytes(job.bytesPerSecond)}/s`);
      const left = timeLeftLabel(total - job.uploadedBytes, job.bytesPerSecond);
      if (left) parts.push(left);
    }
    return parts.join(' · ');
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  /** Queues an upload and returns its job id. Starts at once when nothing else is sending. */
  start(request: UploadRequest): string {
    const job: UploadJob = {
      id: `upload-${++nextJobId}`,
      file:        request.file,
      title:       request.title,
      description: request.description,
      durationSec: request.durationSec,
      facts:       request.facts,
      poster:      request.poster,
      phase: this.isTransferring ? 'queued' : 'uploading',
      progress: 0,
      uploadedBytes: 0,
      bytesPerSecond: 0,
      videoId: null,
      error: '',
    };
    this.items = [...this.items, job];
    this.emit();
    if (job.phase === 'uploading') this.beginTransfer(job);
    return job.id;
  }

  /** Stops an upload (the sending one by default). Not possible while finalising. */
  cancel(id?: string): void {
    const job = id ? this.jobById(id) : this.active;
    if (!job) return;

    if (job.phase === 'queued') {
      this.patch(job, { phase: 'cancelled' });
      return;
    }
    if (job.phase !== 'uploading') return;

    const run = this.runs.get(job.id);
    if (!run || run.cancelled) return;
    run.cancelled = true;
    run.requests.unsubscribe(); // aborts in-flight part uploads
    if (run.rejectPending) {
      run.rejectPending(new UploadCancelled()); // the pipeline cleans up
    } else {
      this.finishCancelled(run, job); // still waiting for the session to be created
    }
  }

  /** Starts a failed or stopped upload again with the same file and details. */
  retry(id?: string): void {
    const job = id
      ? this.jobById(id)
      : this.items.find(j => j.phase === 'failed' || j.phase === 'cancelled') ?? null;
    if (!job || (job.phase !== 'failed' && job.phase !== 'cancelled')) return;

    const phase: UploadJobPhase = this.isTransferring ? 'queued' : 'uploading';
    this.patch(job, { phase, error: '', progress: 0, uploadedBytes: 0, bytesPerSecond: 0 });
    if (phase === 'uploading') this.beginTransfer(job);
  }

  /** Forgets finished, failed or stopped jobs. Processing is still tracked. */
  dismiss(id?: string): void {
    const busy = (job: UploadJob) =>
      job.phase === 'uploading' || job.phase === 'saving' || job.phase === 'queued';
    const keep = this.items.filter(job => busy(job) || (id ? job.id !== id : false));
    if (keep.length === this.items.length) return;
    this.items = keep;
    this.emit();
  }

  // ── Core multipart logic ────────────────────────────────────────────────────

  private beginTransfer(job: UploadJob): void {
    const run: UploadRun = { cancelled: false, requests: new Subscription(), rateSample: null };
    this.runs.set(job.id, run);
    this.patch(job, { phase: 'uploading', progress: 0, uploadedBytes: 0, bytesPerSecond: 0, error: '' });

    // Step 1 – create the multipart upload session. This request isn't aborted
    // mid-flight: if the user stops first, the session is aborted once it exists.
    this.uploadService.startMultipartUpload(job.file.name, job.file.type).subscribe({
      next: ({ uploadId, key, cloudFrontUrl }) => {
        if (run.cancelled) {
          this.abortSession(key, uploadId);
          return;
        }
        this.runMultipartUpload(run, job, uploadId, key, cloudFrontUrl);
      },
      error: (err) => {
        if (run.cancelled) return;
        console.error('[upload] startMultipartUpload failed:', err);
        this.fail(run, job, err.status === 400
          ? 'This file couldn’t be accepted. Check that it’s a video and try again.'
          : 'Couldn’t start the upload. Check your connection and try again.');
      },
    });
  }

  private async runMultipartUpload(
    run:           UploadRun,
    job:           UploadJob,
    uploadId:      string,
    key:           string,
    cloudFrontUrl: string,
  ): Promise<void> {
    const file = job.file;
    const partCount = Math.ceil(file.size / PART_SIZE_BYTES);

    // Per-part byte counters for aggregate progress
    const partLoaded = new Array<number>(partCount).fill(0);
    const updateProgress = () => {
      if (this.runs.get(job.id) !== run) return;
      const loaded = partLoaded.reduce((a, b) => a + b, 0);
      job.uploadedBytes  = loaded;
      job.progress       = Math.round((loaded / file.size) * 100);
      job.bytesPerSecond = this.sampleRate(run, loaded, job.bytesPerSecond);
    };

    try {
      // Step 2 – fetch pre-signed URLs for all parts
      const { parts } = await this.step(run, this.uploadService.getPartUrls(key, uploadId, partCount));

      // Step 3 – upload parts with bounded concurrency (CONCURRENCY at a time)
      const s3UploadStart = Date.now();
      await this.uploadPartsWithConcurrency(run, file, parts, partLoaded, updateProgress, partCount);

      // Step 4 – tell the backend to complete the multipart upload on S3.
      // From here on the upload can't be stopped.
      run.rejectPending = undefined;
      this.patch(job, { phase: 'saving', progress: 100, uploadedBytes: file.size, bytesPerSecond: 0 });

      await new Promise<void>((resolve, reject) => {
        this.uploadService.completeMultipartUpload(key, uploadId).subscribe({ next: () => resolve(), error: reject });
      });
      const s3UploadMs = Date.now() - s3UploadStart;

      // Step 5 – save metadata to backend
      const saved = await new Promise<any>((resolve, reject) => {
        this.uploadService.saveVideoMetadata(this.metadataFor(job, cloudFrontUrl, s3UploadMs))
          .subscribe({ next: resolve, error: reject });
      });

      const videoId: string | null = saved?.video?._id ?? null;
      if (videoId) this.uploadStatus.track(videoId, job.title);
      this.videoService.triggerFeedRefresh();

      this.runs.delete(job.id);
      if (this.signedOut) this.forget(job);
      else this.patch(job, { phase: 'processing', videoId });
      this.startNext();

    } catch (err: any) {
      // Best-effort abort to clean up S3 state
      this.abortSession(key, uploadId);

      if (run.cancelled) {
        this.finishCancelled(run, job);
        return;
      }

      console.error('[upload] Multipart upload error:', err);
      if (err?.error?.error?.includes('duration exceeds')) {
        this.fail(run, job, err.error.error);
      } else if (err?.status === 503) {
        this.fail(run, job, 'Uploads are unavailable right now. Try again in a few minutes.');
      } else {
        this.fail(run, job, 'The upload didn’t finish. Check your connection and try again.');
      }
    }
  }

  /** Awaits one request of the given run; stopping the run rejects it at once. */
  private step<T>(run: UploadRun, source: Observable<T>): Promise<T> {
    if (run.cancelled) return Promise.reject(new UploadCancelled());
    return new Promise<T>((resolve, reject) => {
      run.rejectPending = reject;
      run.requests.add(source.subscribe({ next: resolve, error: reject }));
    });
  }

  /**
   * Upload all parts with at most CONCURRENCY in-flight at once.
   * Each part is a PART_SIZE_BYTES slice of the file (last part may be smaller).
   */
  private uploadPartsWithConcurrency(
    run:            UploadRun,
    file:           File,
    parts:          PartUrl[],
    partLoaded:     number[],
    updateProgress: () => void,
    partCount:      number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (run.cancelled) {
        reject(new UploadCancelled());
        return;
      }
      run.rejectPending = reject;

      let nextIndex = 0;
      let inFlight  = 0;
      let failed    = false;

      const launchNext = () => {
        while (inFlight < CONCURRENCY && nextIndex < partCount && !failed && !run.cancelled) {
          const idx      = nextIndex++;
          const partInfo = parts[idx];
          const start    = idx * PART_SIZE_BYTES;
          const blob     = file.slice(start, start + PART_SIZE_BYTES);

          inFlight++;

          run.requests.add(this.uploadService.uploadPart(
            partInfo.url,
            blob,
            (loaded) => { partLoaded[idx] = loaded; updateProgress(); },
          ).subscribe({
            next: () => {
              partLoaded[idx] = blob.size; // mark complete
              updateProgress();
              inFlight--;
              if (failed) return;
              if (nextIndex < partCount) {
                launchNext();
              } else if (inFlight === 0) {
                resolve();
              }
            },
            error: (err) => {
              if (failed) return;
              failed = true;
              reject(err);
            },
          }));
        }
      };

      launchNext();
    });
  }

  private metadataFor(job: UploadJob, cloudFrontUrl: string, s3UploadMs: number) {
    const user = this.readUser();
    return {
      title:              job.title,
      description:        job.description,
      S3_url:             cloudFrontUrl,
      user_id:            user?.userId       ?? 'UNKNOWN USER',
      userName:           user?.name         ?? 'Unknown User',
      user_profile_image: user?.profileImage ?? null,
      fileSizeBytes:      job.file.size,
      durationSec:        job.durationSec,
      s3UploadMs,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Starts the next waiting upload, if the line is now free. */
  private startNext(): void {
    if (this.isTransferring) return;
    const next = this.items.find(job => job.phase === 'queued');
    if (next) this.beginTransfer(next);
  }

  private patch(job: UploadJob, changes: Partial<UploadJob>): void {
    Object.assign(job, changes);
    this.emit();
  }

  private forget(job: UploadJob): void {
    this.items = this.items.filter(item => item !== job);
    this.emit();
  }

  private emit(): void {
    this.jobsSubject.next([...this.items]);
  }

  private fail(run: UploadRun, job: UploadJob, message: string): void {
    if (this.runs.get(job.id) !== run) return;
    this.runs.delete(job.id);
    if (this.signedOut) this.forget(job);
    else this.patch(job, { phase: 'failed', error: message, bytesPerSecond: 0 });
    this.startNext();
  }

  private finishCancelled(run: UploadRun, job: UploadJob): void {
    if (this.runs.get(job.id) !== run) return;
    this.runs.delete(job.id);
    if (this.signedOut) this.forget(job);
    else this.patch(job, { phase: 'cancelled', progress: 0, uploadedBytes: 0, bytesPerSecond: 0 });
    this.startNext();
  }

  private abortSession(key: string, uploadId: string): void {
    // Best-effort cleanup of S3 state
    this.uploadService.abortMultipartUpload(key, uploadId).subscribe({ error: () => {} });
  }

  /** Smoothed bytes/second, sampled at most twice a second. */
  private sampleRate(run: UploadRun, bytes: number, current: number): number {
    const now = performance.now();
    if (!run.rateSample) {
      run.rateSample = { time: now, bytes };
      return current;
    }
    const seconds = (now - run.rateSample.time) / 1000;
    if (seconds < 0.5) return current;
    const instant = Math.max(0, (bytes - run.rateSample.bytes) / seconds);
    run.rateSample = { time: now, bytes };
    return current > 0 ? current * 0.7 + instant * 0.3 : instant;
  }

  private readUser(): { userId?: string; name?: string; profileImage?: string } | null {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  }
}
