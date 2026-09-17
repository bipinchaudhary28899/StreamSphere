import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AdminService, AdminStats,
  UploadTimingVideo, UploadTiming,
} from '../../services/admin.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.css'],
})
export class AdminDashboardComponent implements OnInit {
  stats: AdminStats | null = null;
  loading = true;
  error: string | null = null;
  lastRefresh: Date | null = null;

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error   = null;
    this.adminService.getStats().subscribe({
      next: (s) => {
        this.stats       = s;
        this.loading     = false;
        this.lastRefresh = new Date();
      },
      error: (err) => {
        this.error   = err?.error?.message || 'Failed to load stats';
        this.loading = false;
      },
    });
  }

  // ── Infra helpers ─────────────────────────────────────────────────────────

  pct(value: number | null, limit: number): number {
    if (value === null || value === 0) return 0;
    return Math.min(100, (value / limit) * 100);
  }

  level(value: number | null, limit: number): 'safe' | 'warn' | 'danger' {
    const p = this.pct(value, limit);
    if (p >= 80) return 'danger';
    if (p >= 50) return 'warn';
    return 'safe';
  }

  fmt(n: number | null, decimals = 0): string {
    if (n === null) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return n.toFixed(decimals);
  }

  fmtGB(n: number | null): string {
    if (n === null) return '—';
    if (n < 0.001)  return '< 0.001 GB';
    return n.toFixed(3) + ' GB';
  }

  // ── Upload Pipeline Timing helpers ────────────────────────────────────────

  fmtMs(ms: number | null): string {
    if (ms === null) return '—';
    if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
    return ms.toFixed(0) + 'ms';
  }

  /** Format a byte count as human-readable size. */
  fmtBytes(bytes: number | undefined): string {
    if (bytes == null) return '—';
    if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(2) + ' GB';
    if (bytes >= 1_048_576)     return (bytes / 1_048_576).toFixed(1) + ' MB';
    if (bytes >= 1_024)         return (bytes / 1_024).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  /** Format seconds as "m:ss". */
  fmtVideoDuration(sec: number | undefined): string {
    if (sec == null || sec === 0) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Actual wall-clock pipeline time, accounting for parallelism:
   *   total = s3UploadMs  (sequential, before Lambda)
   *         + max(p360Ms, p720Ms, p1080Ms, aiMs)  (all run in parallel)
   *         + dbUpdateMs  (sequential, after workers)
   */
  totalPipelineMs(t: UploadTiming): number | null {
    const parallelMs = Math.max(t.p360Ms ?? 0, t.p720Ms ?? 0, t.p1080Ms ?? 0, t.aiMs ?? 0);
    const s3Ms = t.s3UploadMs ?? 0;
    const dbMs = t.dbUpdateMs ?? 0;
    if (parallelMs === 0 && s3Ms === 0) return null;
    return s3Ms + parallelMs + dbMs;
  }

  /** Width % for a timing bar — parallel stages scale against the parallel window. */
  timingBarPct(ms: number | undefined, total: number | null): number {
    if (ms == null || total == null || total === 0) return 0;
    return Math.min(100, Math.round((ms / total) * 100));
  }

  /** Max of the parallel worker timings — used to scale bars within the parallel window. */
  parallelWindowMs(t: UploadTiming): number {
    return Math.max(t.p360Ms ?? 0, t.p720Ms ?? 0, t.p1080Ms ?? 0, t.aiMs ?? 0);
  }

  trackByVideoId(_i: number, v: UploadTimingVideo): string { return v._id; }
}
