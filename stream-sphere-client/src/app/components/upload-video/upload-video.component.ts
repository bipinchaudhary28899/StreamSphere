import { ChangeDetectorRef, Component, ElementRef, Optional, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { UploadService, PartUrl } from '../../services/upload.service';
import { VideoService } from '../../services/video.service';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule, MatDialogConfig } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { UploadStatusService } from '../../services/upload-status.service';

type UploadPhase = 'idle' | 'uploading' | 'saving' | 'success';

/** S3 minimum part size is 5 MiB; 5 MiB gives smooth progress updates. */
const PART_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB

/** Number of parts to upload concurrently. */
const CONCURRENCY = 4;

/** Longest video the platform accepts, in seconds. */
const MAX_DURATION_SEC = 7 * 60;

/** Shared config so every entry point opens the same dialog. */
export const UPLOAD_DIALOG_CONFIG: MatDialogConfig = {
  width: '560px',
  maxWidth: '96vw',
  panelClass: 'ss-upload-dialog',
  ariaLabelledBy: 'upload-title',
  autoFocus: '#upload-dropzone',
  restoreFocus: true,
};

@Component({
  selector: 'app-upload-video',
  standalone: true,
  imports: [ReactiveFormsModule, CommonModule, MatIconModule, MatDialogModule],
  templateUrl: './upload-video.component.html',
  styleUrls: ['./upload-video.component.css']
})
export class UploadVideoComponent {
  uploadForm: FormGroup;
  selectedFile: File | null = null;
  uploadProgress: number = 0;
  isUploading: boolean = false;
  uploadSuccess: boolean = false;
  errorMessage: string = '';
  uploadPhase: UploadPhase = 'idle';
  checkingFile = false;
  isDragging = false;
  submitAttempted = false;

  /** Limits enforced by the API (validators/schemas.ts) */
  readonly TITLE_MAX = 200;
  readonly DESCRIPTION_MAX = 2000;

  @ViewChild('dropzone') private dropzone?: ElementRef<HTMLButtonElement>;
  @ViewChild('titleInput') private titleInput?: ElementRef<HTMLInputElement>;

  /** Timing / size metadata captured during upload — sent to saveVideo endpoint */
  private fileSizeBytes: number = 0;
  private durationSec:   number = 0;

  constructor(
    private fb: FormBuilder,
    private uploadService: UploadService,
    private videoService: VideoService,
    private router: Router,
    private uploadStatus: UploadStatusService,
    private cdr: ChangeDetectorRef,
    @Optional() public dialogRef: MatDialogRef<UploadVideoComponent> | null,
  ) {
    this.uploadForm = this.fb.group({
      title:       ['', [Validators.required, Validators.maxLength(this.TITLE_MAX)]],
      description: ['', Validators.maxLength(this.DESCRIPTION_MAX)],
      video:       [null, Validators.required],
    });
  }

  // ── File selection ──────────────────────────────────────────────────────────

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so choosing the same file again still fires (change)
    input.value = '';
    if (file) this.handleFile(file);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragging = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file && !this.isUploading && !this.checkingFile) this.handleFile(file);
  }

  removeFile() {
    this.selectedFile  = null;
    this.fileSizeBytes = 0;
    this.durationSec   = 0;
    this.errorMessage  = '';
    this.uploadForm.patchValue({ video: null });
    // The button that had focus is gone; hand focus to the drop zone that replaced it
    this.restoreFocus(() => this.dropzone?.nativeElement);
  }

  private handleFile(file: File) {
    this.errorMessage = '';

    if (!file.type.startsWith('video/')) {
      this.errorMessage = `“${file.name}” isn’t a video. Choose an MP4, MOV or WebM file.`;
      return;
    }

    this.checkingFile = true;
    this.checkVideoDuration(file)
      .then(duration => {
        this.checkingFile = false;
        if (duration > MAX_DURATION_SEC) {
          this.errorMessage = `This video is ${this.formatDuration(duration)} long. Videos can be up to 7 minutes.`;
          return;
        }
        this.acceptFile(file, duration);
      })
      .catch(error => {
        // Can't check duration client-side — allow upload, backend will validate
        console.warn('Could not check video duration on client:', error?.message || error);
        this.checkingFile = false;
        this.acceptFile(file, 0);
      });
  }

  private acceptFile(file: File, duration: number) {
    this.selectedFile  = file;
    this.fileSizeBytes = file.size;
    this.durationSec   = duration;
    this.uploadForm.patchValue({ video: file });

    // Suggest a title from the file name if the user hasn't typed one
    const title = this.uploadForm.get('title');
    if (title && !title.value) {
      const suggested = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      title.setValue(suggested.slice(0, this.TITLE_MAX));
    }

    // The drop zone was replaced by the file row; continue at the title
    this.restoreFocus(() => this.titleInput?.nativeElement);
  }

  /**
   * Renders the swap now, then moves focus to `target` if the focused element
   * was removed (or disabled) and focus fell back to the page body.
   */
  private restoreFocus(target: () => HTMLElement | undefined) {
    this.cdr.detectChanges();
    const active = document.activeElement;
    if (!active || active === document.body) target()?.focus();
  }

  private checkVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => { window.URL.revokeObjectURL(video.src); resolve(video.duration); };
      video.onerror           = () => { window.URL.revokeObjectURL(video.src); reject(new Error('Could not load video metadata')); };
      video.src = URL.createObjectURL(file);
    });
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  onSubmit() {
    this.submitAttempted = true;
    if (!this.uploadForm.valid || !this.selectedFile || this.isUploading) {
      this.uploadForm.markAllAsTouched();
      return;
    }

    // Capture the values before setBusy() disables the controls
    const file = this.selectedFile;
    const { title, description } = this.uploadForm.getRawValue();

    this.setBusy(true);
    this.isUploading    = true;
    this.uploadProgress = 0;
    this.uploadPhase    = 'uploading';
    this.errorMessage   = '';

    // Step 1 – create the multipart upload session
    this.uploadService.startMultipartUpload(file.name, file.type).subscribe({
      next: ({ uploadId, key, cloudFrontUrl }) => {
        this.runMultipartUpload(file, uploadId, key, cloudFrontUrl, title, description);
      },
      error: (err) => {
        console.error('[upload] startMultipartUpload failed:', err);
        this.uploadPhase  = 'idle';
        this.isUploading  = false;
        this.setBusy(false);
        this.errorMessage = err.status === 400
          ? 'This file couldn’t be accepted. Check that it’s a video and try again.'
          : 'Couldn’t start the upload. Check your connection and try again.';
      },
    });
  }

  // ── Core multipart logic ────────────────────────────────────────────────────

  private async runMultipartUpload(
    file:          File,
    uploadId:      string,
    key:           string,
    cloudFrontUrl: string,
    title:         string,
    description:   string,
  ): Promise<void> {
    const partCount  = Math.ceil(file.size / PART_SIZE_BYTES);

    // Per-part byte counters for aggregate progress
    const partLoaded = new Array<number>(partCount).fill(0);
    const updateProgress = () => {
      const loaded = partLoaded.reduce((a, b) => a + b, 0);
      this.uploadProgress = Math.round((loaded / file.size) * 100);
    };

    try {
      // Step 2 – fetch pre-signed URLs for all parts
      const { parts } = await new Promise<{ parts: PartUrl[] }>((resolve, reject) => {
        this.uploadService.getPartUrls(key, uploadId, partCount).subscribe({ next: resolve, error: reject });
      });

      // Step 3 – upload parts with bounded concurrency (CONCURRENCY at a time)
      const s3UploadStart = Date.now();
      await this.uploadPartsWithConcurrency(file, parts, partLoaded, updateProgress, partCount);

      // Step 4 – tell the backend to complete the multipart upload on S3
      this.uploadPhase    = 'saving';
      this.uploadProgress = 100;

      await new Promise<void>((resolve, reject) => {
        this.uploadService.completeMultipartUpload(key, uploadId).subscribe({ next: () => resolve(), error: reject });
      });
      const s3UploadMs = Date.now() - s3UploadStart;

      // Step 5 – save metadata to backend
      await this.saveMetadata(cloudFrontUrl, title, description, s3UploadMs);

    } catch (err: any) {
      console.error('[upload] Multipart upload error:', err);

      // Best-effort abort to clean up S3 state
      this.uploadService.abortMultipartUpload(key, uploadId).subscribe({ error: () => {} });

      this.isUploading  = false;
      this.uploadPhase  = 'idle';
      this.setBusy(false);

      if (err?.error?.error?.includes('duration exceeds')) {
        this.errorMessage = err.error.error;
      } else if (err?.status === 503) {
        this.errorMessage = 'Uploads are unavailable right now. Try again in a few minutes.';
      } else {
        this.errorMessage = 'The upload didn’t finish. Check your connection and try again.';
      }
    }
  }

  /**
   * Upload all parts with at most CONCURRENCY in-flight at once.
   * Each part is a 10 MiB slice of the file (last part may be smaller).
   */
  private uploadPartsWithConcurrency(
    file:           File,
    parts:          PartUrl[],
    partLoaded:     number[],
    updateProgress: () => void,
    partCount:      number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let nextIndex = 0;
      let inFlight  = 0;
      let failed    = false;

      const launchNext = () => {
        while (inFlight < CONCURRENCY && nextIndex < partCount && !failed) {
          const idx      = nextIndex++;
          const partInfo = parts[idx];
          const start    = idx * PART_SIZE_BYTES;
          const blob     = file.slice(start, start + PART_SIZE_BYTES);

          inFlight++;

          this.uploadService.uploadPart(
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
          });
        }
      };

      launchNext();
    });
  }

  private saveMetadata(
    cloudFrontUrl: string,
    title:         string,
    description:   string,
    s3UploadMs:    number = 0,
  ): Promise<void> {
    const user = localStorage.getItem('user')
      ? JSON.parse(localStorage.getItem('user')!)
      : null;

    const metadata = {
      title,
      description,
      S3_url:             cloudFrontUrl,
      user_id:            user?.userId       ?? 'UNKNOWN USER',
      userName:           user?.name         ?? 'Unknown User',
      user_profile_image: user?.profileImage ?? null,
      fileSizeBytes:      this.fileSizeBytes,
      durationSec:        this.durationSec,
      s3UploadMs,
    };

    return new Promise((resolve, reject) => {
      this.uploadService.saveVideoMetadata(metadata).subscribe({
        next: (savedVideo: any) => {
          if (savedVideo?.video?._id) {
            this.uploadStatus.track(savedVideo.video._id, title);
          }
          this.uploadPhase    = 'success';
          this.uploadSuccess  = true;
          this.isUploading    = false;
          this.setBusy(false);
          this.uploadForm.reset();
          this.selectedFile   = null;
          this.uploadProgress = 0;
          this.videoService.triggerFeedRefresh();

          setTimeout(() => {
            if (this.dialogRef) this.dialogRef.close('uploaded');
            else this.router.navigate(['/home']);
          }, 2400);

          resolve();
        },
        error: reject,
      });
    });
  }

  // ── View helpers ────────────────────────────────────────────────────────────

  close() {
    if (!this.isUploading) this.dialogRef?.close();
  }

  /**
   * While bytes are moving: keep the dialog open (Esc / backdrop) and lock the
   * fields, since their values were already captured when the upload started.
   */
  private setBusy(busy: boolean) {
    if (this.dialogRef) this.dialogRef.disableClose = busy;
    if (busy) this.uploadForm.disable({ emitEvent: false });
    else this.uploadForm.enable({ emitEvent: false });
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

  get fileSizeLabel(): string {
    return this.formatBytes(this.selectedFile?.size || 0);
  }

  get durationLabel(): string {
    return this.durationSec > 0 ? this.formatDuration(this.durationSec) : '';
  }

  get uploadedLabel(): string {
    const total = this.selectedFile?.size || 0;
    return `${this.formatBytes(total * this.uploadProgress / 100)} of ${this.formatBytes(total)}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${Math.round(bytes)} B`;
  }

  private formatDuration(seconds: number): string {
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
