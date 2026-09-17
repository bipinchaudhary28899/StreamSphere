import {
  ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild,
} from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import {
  UploadFileFacts, UploadJob, UploadJobPhase, UploadManagerService,
} from '../../services/upload-manager.service';
import { ProcessingVideo, UploadStatusService } from '../../services/upload-status.service';
import { formatBytes, formatDuration } from '../../shared/format';
import {
  buildStatusItems, statusIndeterminate, statusLabel, statusProgress, statusTitle,
  statusTone, statusWatchId, UploadStatusItem,
} from '../../shared/upload-status';

type UploadPhase = 'idle' | 'uploading' | 'saving' | 'success';
export type StepState = 'done' | 'current' | 'upcoming';

/** Longest video the platform accepts, in seconds. */
const MAX_DURATION_SEC = 7 * 60;

/** Longest file name the API accepts (validators/schemas.ts). */
const MAX_FILENAME_LENGTH = 255;

/** What the browser could read from the selected file. */
interface VideoInfo {
  duration: number;       // seconds; 0 when unknown
  width: number;
  height: number;
  poster: string | null;  // JPEG data URL of an early frame
}

/**
 * The upload page. Uploads themselves run in UploadManagerService, so people
 * can leave while they continue; coming back here shows where they are.
 */
@Component({
  selector: 'app-upload-video',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, RouterLink, MatIconModule],
  templateUrl: './upload-video.component.html',
  styleUrls: ['./upload-video.component.css']
})
export class UploadVideoComponent implements OnInit, OnDestroy {
  uploadForm: FormGroup;
  selectedFile: File | null = null;
  errorMessage: string = '';
  /** Neutral message, e.g. after stopping an upload */
  noticeMessage: string = '';
  checkingFile = false;
  isDragging = false;
  submitAttempted = false;
  confirmingStop = false;

  /** blob: URL of the selected file, for the preview player */
  previewUrl: string | null = null;
  poster: string | null = null;
  facts: UploadFileFacts | null = null;

  /** Everything else in flight: other uploads from this tab, and videos processing */
  otherUploads: UploadStatusItem[] = [];

  /** Limits enforced by the API (validators/schemas.ts) */
  readonly TITLE_MAX = 200;
  readonly DESCRIPTION_MAX = 2000;

  readonly steps: { n: 1 | 2 | 3; title: string; text: string }[] = [
    { n: 1, title: 'Upload', text: 'Your video uploads in the background, so you can keep browsing. Keep StreamSphere open in this tab until it finishes.' },
    { n: 2, title: 'Processing', text: 'We create 360p, 720p and 1080p streams, a thumbnail, a preview clip and an AI summary.' },
    { n: 3, title: 'Live', text: 'Your video appears in the feed and on your channel.' },
  ];

  /** Shown in the preview so creators see how the video will be credited */
  readonly channelName: string;
  readonly channelImage: string;
  channelImageFailed = false;

  // Status wording shared with the floating cards
  rowTitle = statusTitle;
  rowStatus = statusLabel;
  rowTone = statusTone;
  rowProgress = statusProgress;
  rowIndeterminate = statusIndeterminate;
  rowWatchId = statusWatchId;

  @ViewChild('dropzone') private dropzone?: ElementRef<HTMLButtonElement>;
  @ViewChild('titleInput') private titleInput?: ElementRef<HTMLInputElement>;
  @ViewChild('submitButton') private submitButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('stopButton') private stopButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('keepButton') private keepButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('successHeading') private successHeading?: ElementRef<HTMLElement>;

  /** The upload this page is showing, if any */
  private currentJobId: string | null = null;
  /** Seconds, sent with the upload so the backend can record it */
  private durationSec = 0;
  private inspectToken = 0;
  /** Title we filled in from a file name; replaced when the file changes, unless edited */
  private suggestedTitle = '';
  private lastPhase: UploadJobPhase | null = null;
  private adopted = false;
  /** True while start() runs, so its emission doesn't adopt someone else's upload */
  private starting = false;
  private processing: ProcessingVideo[] = [];
  private readyVideos: ProcessingVideo[] = [];
  private dragTimer?: ReturnType<typeof setTimeout>;
  private subs = new Subscription();
  private destroyed = false;

  constructor(
    private fb: FormBuilder,
    public uploads: UploadManagerService,
    private uploadStatus: UploadStatusService,
    private router: Router,
    private location: Location,
    private cdr: ChangeDetectorRef,
  ) {
    this.uploadForm = this.fb.group({
      title:       ['', [Validators.required, Validators.maxLength(this.TITLE_MAX)]],
      description: ['', Validators.maxLength(this.DESCRIPTION_MAX)],
      video:       [null, Validators.required],
    });

    const user = this.readUser();
    this.channelName = user?.name || 'Your channel';
    this.channelImage = user?.profileImage || '';
  }

  ngOnInit(): void {
    this.subs.add(this.uploads.jobs$.subscribe(() => this.onJobsChange()));

    // Videos still processing, including ones from before a refresh
    this.uploadStatus.recover();
    this.subs.add(this.uploadStatus.processing$.subscribe(list => {
      this.processing = list;
      this.readyVideos = this.readyVideos.filter(v => !list.some(p => p.id === v.id));
      this.rebuildOthers();
    }));
    this.subs.add(this.uploadStatus.ready$.subscribe(id => {
      const video = id ? this.processing.find(v => v.id === id) : null;
      if (video && !this.readyVideos.some(v => v.id === video.id)) {
        this.readyVideos = [...this.readyVideos, video];
        this.rebuildOthers();
      }
    }));
  }

  ngOnDestroy(): void {
    // The uploads keep going in UploadManagerService
    this.destroyed = true;
    this.subs.unsubscribe();
    clearTimeout(this.dragTimer);
    this.revokePreview();
  }

  // ── Upload state (owned by UploadManagerService) ────────────────────────────

  /** The upload this page is about: the one it started, or the one it adopted. */
  get job(): UploadJob | null {
    return this.uploads.jobById(this.currentJobId);
  }

  get uploadPhase(): UploadPhase {
    switch (this.job?.phase) {
      case 'uploading':  return 'uploading';
      case 'saving':     return 'saving';
      case 'processing':
      case 'ready':      return 'success';
      default:           return 'idle';
    }
  }

  /** This page's upload is sending bytes (another one might be, too). */
  get isUploading(): boolean {
    const phase = this.job?.phase;
    return phase === 'uploading' || phase === 'saving';
  }

  get isQueued(): boolean {
    return this.job?.phase === 'queued';
  }

  get uploadProgress(): number {
    return this.job?.progress ?? 0;
  }

  get transferLabel(): string {
    const job = this.job;
    return job ? this.uploads.describeTransfer(job) : '';
  }

  get isReady(): boolean {
    return this.job?.phase === 'ready';
  }

  private onJobsChange(): void {
    if (this.starting) return; // onSubmit syncs once it has the new job's id
    // Adopt an upload that is already running when this page opens, and the
    // last one on first load, so returning here shows where things stand.
    if (!this.currentJobId) {
      const candidate = this.adopted
        ? this.uploads.jobs.find(job => job.phase === 'uploading' || job.phase === 'saving' || job.phase === 'queued')
        : this.uploads.latest;
      if (candidate) this.currentJobId = candidate.id;
    }
    this.adopted = true;

    const job = this.job;
    this.rebuildOthers();
    if (!job) {
      this.lastPhase = null;
      return;
    }

    const previous = this.lastPhase;
    if (job.phase === previous) return; // progress ticks don't emit; phases do
    this.lastPhase = job.phase;

    switch (job.phase) {
      case 'queued':
      case 'uploading':
      case 'saving':
        // Show the file and details being uploaded, locked
        this.mirrorJob(job);
        this.setBusy(true);
        this.errorMessage = '';
        this.noticeMessage = job.phase === 'queued'
          ? 'Waiting for the video ahead of this one to finish uploading.'
          : '';
        if (job.phase === 'saving') this.confirmingStop = false;
        break;

      case 'processing':
      case 'ready':
        this.confirmingStop = false;
        this.mirrorJob(job);
        this.setBusy(false);
        this.noticeMessage = '';
        if (previous === 'uploading' || previous === 'saving') {
          this.restoreFocus(() => this.successHeading?.nativeElement);
        }
        break;

      case 'failed':
        this.confirmingStop = false;
        this.mirrorJob(job);
        this.setBusy(false);
        this.noticeMessage = '';
        this.errorMessage = job.error;
        if (previous === 'uploading' || previous === 'saving') {
          this.restoreFocus(() => this.submitButton?.nativeElement);
        }
        break;

      case 'cancelled':
        this.confirmingStop = false;
        this.mirrorJob(job);
        this.setBusy(false);
        this.errorMessage = '';
        this.noticeMessage = 'Upload stopped. Your file and details are still here, so you can start again.';
        if (previous === 'uploading' || previous === 'queued') {
          this.restoreFocus(() => this.submitButton?.nativeElement);
        }
        break;
    }
  }

  /** Puts the job's file and details into the page (e.g. when coming back to it). */
  private mirrorJob(job: UploadJob): void {
    if (this.selectedFile !== job.file) {
      this.revokePreview();
      this.selectedFile = job.file;
      this.previewUrl = URL.createObjectURL(job.file);
    }
    this.facts = job.facts;
    this.poster = job.poster;
    this.durationSec = job.durationSec;
    this.uploadForm.patchValue(
      { title: job.title, description: job.description, video: job.file },
      { emitEvent: false },
    );
  }

  /** Everything in flight other than the upload this page is showing. */
  private rebuildOthers(): void {
    this.otherUploads = buildStatusItems(this.uploads.jobs, this.processing, this.readyVideos)
      .filter(item => item.key !== this.currentJobId);
  }

  // ── Leaving the page ────────────────────────────────────────────────────────

  /** Cancel before uploading: back to where the user came from. */
  leave(): void {
    if (this.router.lastSuccessfulNavigation?.previousNavigation) {
      this.location.back();
    } else {
      this.router.navigate(['/home']);
    }
  }

  continueBrowsing(): void {
    this.router.navigate(['/home']);
  }

  // ── File selection ──────────────────────────────────────────────────────────

  get canChooseFile(): boolean {
    return !this.isUploading && !this.isQueued && !this.checkingFile && this.uploadPhase !== 'success';
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so choosing the same file again still fires (change)
    input.value = '';
    if (file && this.canChooseFile) this.handleFile(file);
  }

  /** The whole page accepts a dropped file. */
  @HostListener('window:dragover', ['$event'])
  onWindowDragOver(event: DragEvent) {
    if (!this.hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.canChooseFile ? 'copy' : 'none';
    if (this.canChooseFile) this.isDragging = true;

    // dragover repeats while the pointer is over the page; when it stops, the
    // drag has left the window or been cancelled
    clearTimeout(this.dragTimer);
    this.dragTimer = setTimeout(() => (this.isDragging = false), 200);
  }

  @HostListener('window:drop', ['$event'])
  onWindowDrop(event: DragEvent) {
    if (!this.hasFiles(event)) return;
    // Never let the browser navigate away to open the file
    event.preventDefault();
    clearTimeout(this.dragTimer);
    this.isDragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file && this.canChooseFile) this.handleFile(file);
  }

  removeFile() {
    if (!this.canChooseFile) return;
    // A failed or stopped upload of this file is no longer wanted
    const job = this.job;
    if (job && (job.phase === 'failed' || job.phase === 'cancelled')) {
      this.uploads.dismiss(job.id);
      this.currentJobId = null;
      this.lastPhase = null;
    }
    this.clearFile();
    this.errorMessage  = '';
    this.noticeMessage = '';
    // The button that had focus is gone; hand focus to the drop zone that replaced it
    this.restoreFocus(() => this.dropzone?.nativeElement);
  }

  private hasFiles(event: DragEvent): boolean {
    return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
  }

  private handleFile(file: File) {
    this.errorMessage  = '';
    this.noticeMessage = '';

    if (!file.type.startsWith('video/')) {
      this.errorMessage = `“${file.name}” isn’t a video. Choose an MP4, MOV or WebM file.`;
      return;
    }
    if (file.size === 0) {
      this.errorMessage = `“${file.name}” is empty. Choose another file.`;
      return;
    }
    if (file.name.length > MAX_FILENAME_LENGTH) {
      this.errorMessage = `The file name is too long. Rename the file to ${MAX_FILENAME_LENGTH} characters or fewer, then try again.`;
      return;
    }

    const token = ++this.inspectToken;
    this.checkingFile = true;
    this.inspectVideo(file)
      .then(info => {
        if (token !== this.inspectToken) return; // a newer file was chosen
        this.checkingFile = false;
        if (info.duration > MAX_DURATION_SEC) {
          this.errorMessage = `This video is ${formatDuration(info.duration)} long. Videos can be up to 7 minutes.`;
          this.restoreFocus(() => this.dropzone?.nativeElement);
          return;
        }
        this.acceptFile(file, info);
      })
      .catch(error => {
        if (token !== this.inspectToken) return;
        // Can't read it here (e.g. a codec this browser can't decode) —
        // allow the upload, the backend validates it
        console.warn('Could not check video duration on client:', error?.message || error);
        this.checkingFile = false;
        this.acceptFile(file, { duration: 0, width: 0, height: 0, poster: null });
      });
  }

  private acceptFile(file: File, info: VideoInfo) {
    // A new file means this page is no longer about the finished/failed job
    const job = this.job;
    if (job && (job.phase === 'failed' || job.phase === 'cancelled')) {
      this.uploads.dismiss(job.id);
    }
    this.currentJobId = null;
    this.lastPhase = null;

    this.revokePreview();
    this.selectedFile = file;
    this.durationSec  = info.duration;
    this.previewUrl   = URL.createObjectURL(file);
    this.poster       = info.poster;
    this.facts = {
      name:       file.name,
      size:       formatBytes(file.size),
      length:     info.duration > 0 ? formatDuration(info.duration) : '',
      resolution: info.width && info.height ? `${info.width} × ${info.height}` : '',
      format:     this.formatLabel(file),
    };
    this.uploadForm.patchValue({ video: file });

    // Suggest a title from the file name unless the user has written their own
    const title = this.uploadForm.get('title');
    if (title && (!title.value || title.value === this.suggestedTitle)) {
      this.suggestedTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, this.TITLE_MAX);
      title.setValue(this.suggestedTitle);
    }

    this.rebuildOthers();
    // The drop zone was replaced by the file row; continue at the title
    this.restoreFocus(() => this.titleInput?.nativeElement);
  }

  private clearFile() {
    this.inspectToken++; // ignore an inspection that is still running
    this.checkingFile = false;
    this.revokePreview();
    this.selectedFile = null;
    this.poster       = null;
    this.facts        = null;
    this.durationSec  = 0;
    this.uploadForm.patchValue({ video: null });
    this.rebuildOthers();
  }

  private revokePreview() {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
  }

  /** Reads length, resolution and an early frame without uploading anything. */
  private inspectVideo(file: File): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      let info: VideoInfo | null = null;

      const finish = () => {
        clearTimeout(timer);
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        if (info) resolve(info);
        else reject(new Error('Could not load video metadata'));
      };
      // Some files never finish seeking; use what we have after a few seconds
      const timer = setTimeout(finish, 5000);

      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        info = { duration, width: video.videoWidth, height: video.videoHeight, poster: null };
        if (!video.videoWidth) {
          finish(); // no decodable picture
          return;
        }
        // An early frame (the very first is often black) for the poster
        video.currentTime = duration > 0 ? Math.min(1, duration / 2) : 0.1;
      };
      video.onseeked = () => {
        if (info && video.readyState >= 2) info.poster = this.captureFrame(video);
        finish();
      };
      video.onerror = finish;
      video.src = url;
    });
  }

  private captureFrame(video: HTMLVideoElement): string | null {
    try {
      const scale = Math.min(1, 640 / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.8);
    } catch {
      return null;
    }
  }

  // ── Submit / stop ───────────────────────────────────────────────────────────

  onSubmit() {
    this.submitAttempted = true;
    if (!this.selectedFile || !this.facts || this.isUploading || this.isQueued || this.checkingFile) return;
    if (this.uploadForm.invalid) {
      this.uploadForm.markAllAsTouched();
      this.titleInput?.nativeElement.focus();
      return;
    }

    const { title, description } = this.uploadForm.getRawValue();
    this.lastPhase = null;
    this.starting = true;
    this.currentJobId = this.uploads.start({
      file:        this.selectedFile,
      title,
      description: description || '',
      durationSec: this.durationSec,
      facts:       this.facts,
      poster:      this.poster,
    });
    this.starting = false;
    this.onJobsChange();
  }

  askStop() {
    this.confirmingStop = true;
    this.restoreFocus(() => this.keepButton?.nativeElement);
  }

  keepUploading() {
    this.confirmingStop = false;
    this.restoreFocus(() => this.stopButton?.nativeElement);
  }

  cancelUpload() {
    if (this.currentJobId) this.uploads.cancel(this.currentJobId);
  }

  /** Clears the page for the next video; the finished upload keeps its card. */
  uploadAnother() {
    this.currentJobId    = null;
    this.lastPhase       = null;
    this.submitAttempted = false;
    this.errorMessage    = '';
    this.noticeMessage   = '';
    this.confirmingStop  = false;
    this.setBusy(false);
    this.uploadForm.reset({ title: '', description: '', video: null });
    this.suggestedTitle = '';
    this.clearFile();
    this.restoreFocus(() => this.dropzone?.nativeElement);
  }

  // ── View helpers ────────────────────────────────────────────────────────────

  /** While bytes are moving, lock the fields: their values were already captured. */
  private setBusy(busy: boolean) {
    if (busy) this.uploadForm.disable({ emitEvent: false });
    else this.uploadForm.enable({ emitEvent: false });
  }

  /**
   * Renders the change now, then moves focus to `target` if the focused element
   * was removed (or disabled) and focus fell back to the page body.
   */
  private restoreFocus(target: () => HTMLElement | undefined) {
    if (this.destroyed) return;
    this.cdr.detectChanges();
    const active = document.activeElement;
    if (!active || active === document.body) target()?.focus();
  }

  stepState(step: 1 | 2 | 3): StepState {
    const sending = this.uploadPhase === 'uploading' || this.uploadPhase === 'saving';
    const sent = this.uploadPhase === 'success';
    switch (step) {
      case 1: return sent ? 'done' : sending ? 'current' : 'upcoming';
      case 2: return !sent ? 'upcoming' : this.isReady ? 'done' : 'current';
      case 3: return this.isReady ? 'done' : 'upcoming';
    }
  }

  stepStateLabel(step: 1 | 2 | 3): string {
    const state = this.stepState(step);
    return state === 'done' ? 'done' : state === 'current' ? 'in progress' : 'not started';
  }

  get titleValue(): string {
    return (this.uploadForm.get('title')?.value || '').trim();
  }

  get titleLength(): number {
    return (this.uploadForm.get('title')?.value || '').length;
  }

  get descriptionLength(): number {
    return (this.uploadForm.get('description')?.value || '').length;
  }

  get showTitleError(): boolean {
    const title = this.uploadForm.get('title');
    return !!title && title.invalid && (title.touched || this.submitAttempted);
  }

  get channelInitials(): string {
    const parts = this.channelName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'U';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  trackByKey(_: number, item: UploadStatusItem): string {
    return item.key;
  }

  private formatLabel(file: File): string {
    const known: Record<string, string> = {
      'video/mp4': 'MP4',
      'video/quicktime': 'MOV',
      'video/webm': 'WebM',
      'video/x-matroska': 'MKV',
      'video/x-msvideo': 'AVI',
    };
    if (known[file.type]) return known[file.type];
    const extension = file.name.includes('.') ? file.name.split('.').pop() || '' : '';
    return (extension || file.type.replace('video/', '')).toUpperCase();
  }

  private readUser(): { name?: string; profileImage?: string } | null {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  }
}
