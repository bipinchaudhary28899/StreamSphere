import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpEvent,
  HttpRequest,
  HttpHeaders,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface MultipartStart {
  uploadId:      string;
  key:           string;
  cloudFrontUrl: string;
}

export interface PartUrl {
  partNumber: number;
  url:        string;
}

@Injectable({
  providedIn: 'root',
})
export class UploadService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ── Legacy single-PUT (kept for reference / small-file fallback) ─────────

  getSignedUrl(
    filename: string,
    filetype: string,
  ): Observable<{ signedUrl: string; cloudFrontUrl: string }> {
    return this.http.post<{ signedUrl: string; cloudFrontUrl: string }>(
      `${this.baseUrl}/upload-url`,
      { filename, filetype },
    );
  }

  uploadToS3(signedUrl: string, file: File): Observable<HttpEvent<any>> {
    const req = new HttpRequest('PUT', signedUrl, file, {
      headers: new HttpHeaders({ 'Content-Type': file.type }),
      reportProgress: true,
    });
    return this.http.request(req);
  }

  // ── Multipart upload ─────────────────────────────────────────────────────

  /** Step 1 – create the multipart upload session on S3 via backend. */
  startMultipartUpload(filename: string, filetype: string): Observable<MultipartStart> {
    return this.http.post<MultipartStart>(
      `${this.baseUrl}/upload/multipart/start`,
      { filename, filetype },
    );
  }

  /** Step 2 – get pre-signed PUT URLs for each part. */
  getPartUrls(key: string, uploadId: string, partCount: number): Observable<{ parts: PartUrl[] }> {
    return this.http.post<{ parts: PartUrl[] }>(
      `${this.baseUrl}/upload/multipart/part-urls`,
      { key, uploadId, partCount },
    );
  }

  /**
   * Step 3a – upload one part to S3 directly via XHR.
   * Returns an Observable that emits upload-progress as 0–100 and completes
   * when the part is fully sent.  XHR is used (not HttpClient) so we get
   * granular byte-level progress on each part.
   */
  uploadPart(
    url:        string,
    blob:       Blob,
    onProgress: (loaded: number, total: number) => void,
  ): Observable<void> {
    return new Observable(observer => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          observer.next();
          observer.complete();
        } else {
          observer.error(new Error(`Part upload failed with HTTP ${xhr.status}`));
        }
      };

      xhr.onerror   = () => observer.error(new Error('Part upload network error'));
      xhr.onabort   = () => observer.error(new Error('Part upload aborted'));

      xhr.send(blob);

      // Allow the Observable to be cancelled
      return () => xhr.abort();
    });
  }

  /** Step 3b – tell the backend to call ListParts + CompleteMultipartUpload. */
  completeMultipartUpload(key: string, uploadId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${this.baseUrl}/upload/multipart/complete`,
      { key, uploadId },
    );
  }

  /** Abort – clean up S3 state on error. Best-effort; ignore failures. */
  abortMultipartUpload(key: string, uploadId: string): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/upload/multipart/abort`,
      { key, uploadId },
    );
  }

  saveVideoMetadata(metadata: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/save-video`, metadata);
  }
}
