import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { UploadService } from '../../services/upload.service';
import { HttpEventType, HttpProgressEvent } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { CommonModule } from '@angular/common';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router } from '@angular/router';

@Component({
  selector: 'app-upload-video',
  standalone: true,
  imports: [ReactiveFormsModule, MatButtonModule, MatInputModule, CommonModule, MatProgressBarModule],
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

  constructor(
    private fb: FormBuilder,
    private uploadService: UploadService,
    private router: Router
  ) {
    this.uploadForm = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      video: [null, Validators.required]
    });
  }

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
        if (duration > 180) {
          this.errorMessage = 'Video duration exceeds 3 minutes. Please select a shorter video.';
          input.value = '';
          this.selectedFile = null;
          return;
        }
        this.selectedFile = file;
        this.uploadForm.patchValue({ video: file });
      })
      .catch(error => {
        // Can't check duration client-side — allow upload, backend will validate
        console.warn('Could not check video duration on client:', error?.message || error);
        this.selectedFile = file;
        this.uploadForm.patchValue({ video: file });
      });
  }

  private checkVideoDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';

      video.onloadedmetadata = () => {
        window.URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };

      video.onerror = () => {
        window.URL.revokeObjectURL(video.src);
        reject(new Error('Could not load video metadata'));
      };

      video.src = URL.createObjectURL(file);
    });
  }

  onSubmit() {
    if (!this.uploadForm.valid || !this.selectedFile) return;

    this.isUploading = true;
    this.uploadProgress = 0;
    this.errorMessage = '';

    const file = this.selectedFile;
    const { title, description } = this.uploadForm.value;

    // Step 1: Get signed URL + CloudFront URL from backend
    this.uploadService.getSignedUrl(file.name, file.type).subscribe({
      next: ({ signedUrl, cloudFrontUrl }) => {

        // Step 2: Upload file directly to S3 using signed URL
        this.uploadService.uploadToS3(signedUrl, file).subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress) {
              const progressEvent = event as HttpProgressEvent;
              if (progressEvent.total) {
                this.uploadProgress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
              }
            }

            if (event.type === HttpEventType.Response) {
              // Step 3: Save metadata with CloudFront URL (not the S3 URL)
              const user = localStorage.getItem('user')
                ? JSON.parse(localStorage.getItem('user')!)
                : null;

              const metadata = {
                title,
                description,
                S3_url: cloudFrontUrl,  // CloudFront URL saved to MongoDB
                user_id: user?.userId ?? 'UNKNOWN USER',
                userName: user?.name ?? 'Unknown User',
              };

              this.uploadService.saveVideoMetadata(metadata).subscribe({
                next: () => {
                  this.uploadSuccess = true;
                  this.isUploading = false;
                  this.uploadForm.reset();
                  this.selectedFile = null;
                  this.uploadProgress = 0;
                  setTimeout(() => this.router.navigate(['/home']), 1500);
                },
                error: (err) => {
                  console.error('[upload] Error saving metadata:', err);
                  this.isUploading = false;

                  if (err.error?.error?.includes('duration exceeds')) {
                    this.errorMessage = err.error.error;
                  } else if (err.error?.error?.includes('Category prediction failed')) {
                    this.errorMessage = 'Could not categorize video. Please try again.';
                  } else if (err.status === 503) {
                    this.errorMessage = 'Service temporarily unavailable. Please try again later.';
                  } else {
                    this.errorMessage = 'Error saving video. Please try again.';
                  }
                }
              });
            }
          },
          error: (err) => {
            console.error('[upload] Error uploading to S3:', err);
            this.isUploading = false;
            this.errorMessage = 'Upload to storage failed. Please try again.';
          }
        });
      },
      error: (err) => {
        console.error('[upload] Error getting signed URL:', err);
        this.isUploading = false;

        if (err.status === 400) {
          this.errorMessage = 'Invalid file. Please check the file and try again.';
        } else {
          this.errorMessage = 'Could not initiate upload. Please try again.';
        }
      }
    });
  }
}