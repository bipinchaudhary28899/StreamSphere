import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

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
  errors: { cloudfront: string | null; s3: string | null };
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private base = environment.apiUrl;
  constructor(private http: HttpClient) {}

  getStats(): Observable<AdminStats> {
    return this.http.get<AdminStats>(`${this.base}/admin/stats`);
  }
}
