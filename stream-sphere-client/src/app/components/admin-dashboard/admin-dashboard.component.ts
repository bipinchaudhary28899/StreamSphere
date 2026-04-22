import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminService, AdminStats } from '../../services/admin.service';

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

  ngOnInit(): void { this.load(); }

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

  /** Returns a 0–100 percentage, capped at 100. */
  pct(value: number | null, limit: number): number {
    if (value === null || value === 0) return 0;
    return Math.min(100, (value / limit) * 100);
  }

  /** Returns 'safe' | 'warn' | 'danger' based on usage %. */
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
}
