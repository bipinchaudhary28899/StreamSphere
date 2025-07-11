import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpRequest, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class UploadService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getSignedUrl(filename: string, filetype: string): Observable<{ signedUrl: string, fileUrl: string }> {
    return this.http.post<{ signedUrl: string, fileUrl: string }>(`${this.baseUrl}/upload-url`, { filename, filetype });
  }

  uploadToS3(signedUrl: string, file: File): Observable<HttpEvent<any>> {
    const headers = new HttpHeaders({
      'Content-Type': file.type
    });

    const req = new HttpRequest('PUT', signedUrl, file, {
      headers: headers,
      reportProgress: true
    });

    return this.http.request(req);
  }

  saveVideoMetadata(metadata: any): Observable<any> {
    console.log('meta data for saving is ', metadata);
    return this.http.post<any>(`${this.baseUrl}/save-video`, metadata);
  }
}
