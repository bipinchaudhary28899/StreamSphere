import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminService, AdminStats, SessionGroupStats, RecentSession } from '../../services/admin.service';

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

  // ── Existing helpers ──────────────────────────────────────────────────────

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

  // ── GenABR helpers ────────────────────────────────────────────────────────

  fmtN(n: number | null, decimals = 1): string {
    if (n === null) return '—';
    return n.toFixed(decimals);
  }

  fmtMs(ms: number | null): string {
    if (ms === null) return '—';
    if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
    return ms.toFixed(0) + 'ms';
  }

  fmtDuration(startedAt: string, endedAt: string | null): string {
    if (!endedAt) return 'ongoing';
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    const m  = Math.floor(ms / 60_000);
    const s  = Math.floor((ms % 60_000) / 1000);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  /**
   * Compute the % improvement of `withVal` over `withoutVal`.
   * Returns a formatted string like "+64%" or "—" if data is missing.
   * For metrics where lower is better (stalls, stall time), set `lowerIsBetter=true`
   * so the sign reads correctly.
   */
  improvement(withVal: number | null, withoutVal: number | null, lowerIsBetter = false): string {
    if (withVal === null || withoutVal === null || withoutVal === 0) return '—';
    const delta = ((withVal - withoutVal) / Math.abs(withoutVal)) * 100;
    const pct   = lowerIsBetter ? -delta : delta;
    const sign  = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(0)}%`;
  }

  improvementClass(withVal: number | null, withoutVal: number | null, lowerIsBetter = false): string {
    if (withVal === null || withoutVal === null || withoutVal === 0) return '';
    const delta = withVal - withoutVal;
    const improved = lowerIsBetter ? delta < 0 : delta > 0;
    return improved ? 'gn-improve' : 'gn-regress';
  }

  /** Width % for the mini comparison bar (0–100, relative to the larger value). */
  barPct(val: number | null, max: number | null): number {
    if (val === null || max === null || max === 0) return 0;
    return Math.min(100, (val / max) * 100);
  }

  genabrSharePct(): number {
    const g = this.stats?.genabr;
    if (!g || g.totalSessions === 0) return 0;
    return Math.round((g.withGenabr.count / g.totalSessions) * 100);
  }

  phiDelta(): string {
    return this.improvement(
      this.stats?.genabr?.withGenabr.avgPhi ?? null,
      this.stats?.genabr?.withoutGenabr.avgPhi ?? null,
    );
  }

  trackBySessionId(_i: number, s: RecentSession): string { return s.sessionId; }
}
