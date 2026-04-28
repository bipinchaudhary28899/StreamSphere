import { Component, OnInit, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AdminService, AdminStats, SessionGroupStats, RecentSession,
  OracleTriggerItem, OracleRecentDecision,
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

  // ── GenABR Master Toggle ─────────────────────────────────────────────────
  genabrEnabled  = true;   // default ON; real value loaded in ngOnInit
  toggleLoading  = false;
  toggleError: string | null = null;

  /** Bind CSS class to host so the entire dashboard theme shifts on toggle. */
  @HostBinding('class.genabr-off') get genabrOffTheme() { return !this.genabrEnabled; }
  @HostBinding('class.genabr-on')  get genabrOnTheme()  { return  this.genabrEnabled; }

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.loadGenabrStatus();
    this.load();
  }

  /** Fetch the current global GenABR flag. */
  loadGenabrStatus(): void {
    this.adminService.getGenabrEnabled().subscribe({
      next:  (r) => { this.genabrEnabled = r.enabled; },
      error: ()  => { /* non-critical — keep default true */ },
    });
  }

  /** Admin-only: flip GenABR on/off globally for all users. */
  toggleGenabr(): void {
    if (this.toggleLoading) return;
    this.toggleLoading = true;
    this.toggleError   = null;
    const next = !this.genabrEnabled;
    this.adminService.setGenabrEnabled(next).subscribe({
      next: (r) => {
        this.genabrEnabled = r.enabled;
        this.toggleLoading = false;
      },
      error: (err) => {
        // Extract the most useful message available
        const body    = err?.error;
        const bodyMsg = typeof body === 'object' ? body?.message : body;
        const status  = err?.status ? `HTTP ${err.status}` : null;
        this.toggleError = bodyMsg || status || err?.message || 'Request failed';
        this.toggleLoading = false;
      },
    });
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

  // ── GenABR session helpers ────────────────────────────────────────────────

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

  // ── Oracle insights helpers ───────────────────────────────────────────────

  /** Max count value in an OracleTriggerItem array — used to scale bars. */
  maxCount(items: OracleTriggerItem[] | undefined): number {
    if (!items || items.length === 0) return 1;
    return Math.max(...items.map(i => i.count), 1);
  }

  /** Human-readable label for recommendation codes. */
  recLabel(code: string): string {
    const map: Record<string, string> = {
      'normal':               'Normal',
      'prebuffer_moderate':   'Moderate Prebuffer',
      'prebuffer_aggressive': 'Aggressive Prebuffer',
    };
    return map[code] ?? code;
  }

  /** CSS class for recommendation badge. */
  recClass(code: string): string {
    if (code === 'prebuffer_aggressive') return 'or-rec-agg';
    if (code === 'prebuffer_moderate')   return 'or-rec-mod';
    return 'or-rec-normal';
  }

  /** Human-readable label for speed categories. */
  speedLabel(cat: string | null): string {
    const map: Record<string, string> = {
      stationary: 'Stationary',
      urban:      'Urban (<40 km/h)',
      suburban:   'Suburban (<80 km/h)',
      highway:    'Highway (≥80 km/h)',
    };
    return map[cat ?? ''] ?? (cat ?? '—');
  }

  /** Speed category icon. */
  speedIcon(cat: string | null): string {
    const map: Record<string, string> = {
      stationary: '🏠', urban: '🏙️', suburban: '🚗', highway: '🛣️',
    };
    return map[cat ?? ''] ?? '📍';
  }

  /** Human-readable trigger reason tags. */
  reasonLabel(tag: string): string {
    const map: Record<string, string> = {
      highway_speed:      'Highway speed',
      urban_speed:        'Urban speed',
      signal_degrading:   'Signal degrading',
      signal_recovering:  'Signal recovering',
      peak_hours:         'Peak hours',
      no_adjustment:      'No adjustment',
    };
    return map[tag] ?? tag.replace(/_/g, ' ');
  }

  /** CSS colour class for trigger reason tags. */
  reasonClass(tag: string): string {
    if (tag.includes('signal_degrading') || tag.includes('highway')) return 'or-tag-danger';
    if (tag.includes('peak') || tag.includes('urban'))               return 'or-tag-warn';
    if (tag.includes('recovering'))                                    return 'or-tag-ok';
    return 'or-tag-neutral';
  }

  /** Format a risk score as "0.34" with a colour class. */
  riskClass(risk: number): string {
    if (risk >= 0.45) return 'or-risk-high';
    if (risk >= 0.20) return 'or-risk-mid';
    return 'or-risk-low';
  }

  fmtRisk(r: number): string { return r.toFixed(3); }

  fmtSec(s: number | null): string {
    if (s === null) return '—';
    return s.toFixed(1) + 's';
  }

  fmtPct(n: number | null): string {
    if (n === null) return '—';
    return n.toFixed(0) + '%';
  }

  /** Shorten reasoning text to 120 chars for the table. */
  shortReasoning(text: string): string {
    if (!text) return '—';
    return text.length > 120 ? text.slice(0, 120) + '…' : text;
  }

  /** Total tokens formatted with comma separator. */
  fmtTokens(n: number): string {
    return n.toLocaleString('en-US');
  }

  trackByTimestamp(_i: number, d: OracleRecentDecision): string { return d.timestamp; }
}
