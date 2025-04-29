import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { UploadService } from '../../services/upload.service';
import { HttpEventType, HttpProgressEvent, HttpResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';  // Import Material Button
import { MatInputModule } from '@angular/material/input';    // Import Material Input
import { CommonModule } from '@angular/common';
import { MatProgressBarModule } from '@angular/material/progress-bar';

@Component({
  selector: 'app-upload-video',
  standalone: true,
  imports: [ReactiveFormsModule, MatButtonModule, MatInputModule,CommonModule,MatProgressBarModule],  // Add the necessary imports here
  templateUrl: './upload-video.component.html',
  styleUrls: ['./upload-video.component.css']
})
export class UploadVideoComponent {
  uploadForm: FormGroup;
  selectedFile: File | null = null;
  uploadProgress: number = 0;
  isUploading: boolean = false;
  uploadSuccess: boolean = false;

  constructor(
    private fb: FormBuilder,
    private uploadService: UploadService
  ) {
    this.uploadForm = this.fb.group({
      title: ['', Validators.required],
      description: ['', Validators.required],
      video: [null, Validators.required]
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
      this.uploadForm.patchValue({ video: this.selectedFile });
    }
  }

  onSubmit() {
    if (!this.uploadForm.valid || !this.selectedFile) return;
  
    this.isUploading = true;
    this.uploadProgress = 0;
  
    const file = this.selectedFile;
    const { title, description } = this.uploadForm.value;
  
    // Step 1: Get signed URL from backend
    this.uploadService.getSignedUrl(file.name, file.type).subscribe({
      next: (res) => {
        const signedUrl = res.signedUrl;
  
        // Step 2: Upload the file directly to S3
        this.uploadService.uploadToS3(signedUrl, file).subscribe({
          next: (event) => {
            switch (event.type) {
              case HttpEventType.UploadProgress:
                const progressEvent = event as HttpProgressEvent;
                if (progressEvent.total) {
                  this.uploadProgress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                }
                break;
  
              case HttpEventType.Response:
                console.log('Upload success!');
  
                // Step 3: Construct the file URL from the signed URL (removing query params)
                const fileUrl = signedUrl.split('?')[0];
  
                // Step 4: Save video metadata in backend
                const metadata = {
                  title,
                  description,
                  url: fileUrl,
                  userId: 'demoUserId123', 
                };
  
                this.uploadService.saveVideoMetadata(metadata).subscribe({
                  next: () => {
                    console.log('Video saved in DB!');
                    this.uploadSuccess = true;
                    this.isUploading = false;
                    this.uploadForm.reset();
                    this.selectedFile = null;
                    this.uploadProgress = 0;
                  },
                  error: (err) => {
                    console.error('Error saving metadata:', err);
                    this.isUploading = false;
                  }
                });
                break;
            }
          },
          error: (err) => {
            console.error('Error uploading to S3:', err);
            this.isUploading = false;
          }
        });
      },
      error: (err) => {
        console.error('Error generating signed URL:', err);
        this.isUploading = false;
      }
    });
  }
  
}
