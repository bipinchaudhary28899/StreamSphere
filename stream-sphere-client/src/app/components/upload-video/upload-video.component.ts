import { Component, Optional } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { UploadService, PartUrl } from '../../services/upload.service';
import { VideoService } from '../../services/video.service';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { UploadStatusService } from '../../services/upload-status.service';

type UploadPhase = 'idle' | 'uploading' | 'saving' | 'success';

/** S3 minimum part size is 5 MiB; 5 MiB gives smooth progress updates. */
const PART_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB

/** Number of parts to upload concurrently. */
const CONCURRENCY = 4;

@Component({
  selector: 'app-upload-video',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatButtonModule, MatInputModule,
    CommonModule, MatProgressBarModule, MatIconModule, MatDialogModule,
  ],
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

  /** Timing / size metadata captured during upload — sent to saveVideo endpoint */
  private fileSizeBytes: number = 0;
  private durationSec:   number = 0;

  constructor(
    private fb: FormBuilder,
    private uploadService: UploadService,
    private videoService: VideoService,
    private router: Router,
    private uploadStatus: UploadStatusService,
    @Optional() public dialogRef: MatDialogRef<UploadVideoComponent> | null,
  ) {
    this.uploadForm = this.fb.group({
      title:       ['', Validators.required],
      description: [''],
      video:       [null, Validators.required],
    });
  }

  // ── File selection ──────────────────────────────────────────────────────────

  onFileSelected(event: Event) {
    this.errorMessage = '';
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];

    if (!file.type.startsWith('video/')) {
      this.errorMessage = 'Please select a valid video file.';
      input.value = '';
      return;
    }

    this.checkVideoDuration(file)
      .then(duration => {
        if (duration > 420) {
          this.errorMessage = 'Video duration exceeds 7 minutes. Please select a shorter video.';
          input.value = '';
          this.selectedFile = null;
          return;
        }
        this.selectedFile  = file;
        this.fileSizeBytes = file.size;
        this.durationSec   = duration;
        this.uploadForm.patchValue({ video: file });
      })
      .catch(error => {
        // Can't check duration client-side — allow upload, backend will validate
        console.warn('Could not check video duration on client:', error?.message || error);
        this.selectedFile  = file;
        this.fileSizeBytes = file.size;
        this.durationSec   = 0;
        this.uploadForm.patchValue({ video: file });
      });
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
    if (!this.uploadForm.valid || !this.selectedFile) return;

    this.isUploading    = true;
    this.uploadProgress = 0;
    this.uploadPhase    = 'uploading';
    this.errorMessage   = '';

    const file = this.selectedFile;
    const { title, description } = this.uploadForm.value;

    // Step 1 – create the multipart upload session
    this.uploadService.startMultipartUpload(file.name, file.type).subscribe({
      next: ({ uploadId, key, cloudFrontUrl }) => {
        this.runMultipartUpload(file, uploadId, key, cloudFrontUrl, title, description);
      },
      error: (err) => {
        console.error('[upload] startMultipartUpload failed:', err);
        this.uploadPhase  = 'idle';
        this.isUploading  = false;
        this.errorMessage = err.status === 400
          ? 'Invalid file. Please check the file and try again.'
          : 'Could not initiate upload. Please try again.';
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

      if (err?.error?.error?.includes('duration exceeds')) {
        this.errorMessage = err.error.error;
      } else if (err?.status === 503) {
        this.errorMessage = 'Service temporarily unavailable. Please try again later.';
      } else {
        this.errorMessage = 'Upload failed. Please try again.';
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
          this.uploadForm.reset();
          this.selectedFile   = null;
          this.uploadProgress = 0;
          this.videoService.triggerFeedRefresh();

          setTimeout(() => {
            if (this.dialogRef) this.dialogRef.close('uploaded');
            else this.router.navigate(['/home']);
          }, 1800);

          resolve();
        },
        error: reject,
      });
    });
  }
}
