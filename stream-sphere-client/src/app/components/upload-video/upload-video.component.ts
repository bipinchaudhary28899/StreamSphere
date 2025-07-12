import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { UploadService } from '../../services/upload.service';
import { HttpEventType, HttpProgressEvent, HttpResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';  // Import Material Button
import { MatInputModule } from '@angular/material/input';    // Import Material Input
import { CommonModule } from '@angular/common';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router } from '@angular/router';

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
    private uploadService: UploadService,
    private router: Router
  ) {
    this.uploadForm = this.fb.group({
      title: ['', Validators.required],
      description: [''], // Remove required validator to make it optional
      video: [null, Validators.required]
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      
      // Check if it's a video file
      if (!file.type.startsWith('video/')) {
        alert('Please select a valid video file.');
        return;
      }
      
      // Check video duration
      this.checkVideoDuration(file).then(duration => {
        if (duration > 120) { // 2 minutes = 120 seconds
          alert('Video duration exceeds 2 minutes. Please select a shorter video.');
          input.value = '';
          this.selectedFile = null;
          return;
        }
        
        this.selectedFile = file;
        this.uploadForm.patchValue({ video: file });
      }).catch(error => {
        console.error('Error checking video duration:', error);
        // If we can't check duration, still allow the upload
        this.selectedFile = file;
        this.uploadForm.patchValue({ video: file });
      });
    }
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
                console.log('is theuser still logged in : ', localStorage.getItem('user'))
                const user = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!) : null;
                const metadata = {
                  title,
                  description: description, // Use the user's description input
                  S3_url: fileUrl,
                  user_id: user ? user.userId : 'UNKNOWN USER',
                  user_name: user ? user.name : 'Unknown User',
                };
  
                this.uploadService.saveVideoMetadata(metadata).subscribe({
                  next: () => {
                    console.log('Video saved in DB!');
                    this.uploadSuccess = true;
                    this.isUploading = false;
                    this.uploadForm.reset();
                    this.selectedFile = null;
                    this.uploadProgress = 0;
                    setTimeout(() => {
                      this.router.navigate(['/home']);
                    }, 1500); // Redirect after 1.5 seconds
                  },
                  error: (err) => {
                    console.error('Error saving metadata:', err);
                    this.isUploading = false;
                    
                    // Handle duration error from backend
                    if (err.error && err.error.error && err.error.error.includes('duration exceeds')) {
                      alert(err.error.error);
                    } else {
                      alert('Error saving video. Please try again.');
                    }
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
