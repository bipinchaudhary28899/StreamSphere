import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ── Upload Pipeline Timings ───────────────────────────────────────────────────

export interface UploadTiming {
  fileSizeBytes?: number;
  durationSec?:   number;
  s3UploadMs?:    number;
  aiMs?:          number;
  p360Ms?:        number;
  p720Ms?:        number;
  p1080Ms?:       number;
  dbUpdateMs?:    number;
}

export interface UploadTimingVideo {
  _id:          string;
  title:        string;
  uploadedAt:   string;
  uploadTiming: UploadTiming;
}

// ── Full dashboard stats ──────────────────────────────────────────────────────

export interface AdminStats {
  period: string;
  generatedAt: string;
  cloudfront: {
    distributionConfigured: boolean;
    requests:       number | null;
    dataTransferGB: number | null;
  };
  s3: {
    storageGB:   number | null;
    objectCount: number | null;
    putRequests: number;
  };
  backend: {
    apiRequestsMonth: number;
    apiRequestsToday: number;
  };
  app: {
    videos:   number;
    users:    number;
    comments: number;
  };
  limits: {
    cloudfront: { requests: number; dataTransferGB: number };
    s3:         { storageGB: number; putRequests: number; getRequests: number; dataTransferGB: number };
  };
  uploadTimings:  UploadTimingVideo[]   | null;
  errors: {
    cloudfront:  string | null;
    s3:          string | null;
  };
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private base = environment.apiUrl;
  constructor(private http: HttpClient) {}

  getStats(): Observable<AdminStats> {
    return this.http.get<AdminStats>(`${this.base}/admin/stats`);
  }
}
