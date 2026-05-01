import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CoverageResult {
  tile_id:            string;
  fused_score:        number;
  static_score:       number;
  user_history_score: number | null;
  dead_zone_risk:     number;
  from_cache:         boolean;
  recommendation:     'prebuffer_aggressive' | 'prebuffer_moderate' | 'normal';
}

// How far the user must move (metres) before we re-query the shadow map
const QUERY_DISTANCE_THRESHOLD_M = 200;
// Minimum ms between queries regardless of movement
const MIN_QUERY_INTERVAL_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class ShadowMapService {
  private apiUrl = environment.apiUrl;

  private coverageSubject = new BehaviorSubject<CoverageResult | null>(null);
  coverage$: Observable<CoverageResult | null> = this.coverageSubject.asObservable();

  private lastQueryLat:  number | null = null;
  private lastQueryLng:  number | null = null;
  private lastQueryTime: number = 0;

  constructor(private http: HttpClient) {}

  // ── Called by TelemetryService / VideoPlayer on position updates ──────────

  onPositionUpdate(lat: number, lng: number): void {
    const now = Date.now();
    const timeSinceLast = now - this.lastQueryTime;

    const distMoved = (this.lastQueryLat !== null && this.lastQueryLng !== null)
      ? haversineMetres(this.lastQueryLat, this.lastQueryLng, lat, lng)
      : Infinity;

    const shouldQuery =
      timeSinceLast > MIN_QUERY_INTERVAL_MS ||
      distMoved > QUERY_DISTANCE_THRESHOLD_M;

    if (shouldQuery) {
      this.queryCoverage(lat, lng);
    }
  }

  // Called immediately when video starts — always query fresh
  onVideoStart(lat: number, lng: number): void {
    this.queryCoverage(lat, lng, false);
  }

  // Called when buffer health drops low — force a fresh query
  onBufferRisk(lat: number, lng: number): void {
    this.queryCoverage(lat, lng, true);
  }

  // ── Core query ────────────────────────────────────────────────────────────

  private queryCoverage(lat: number, lng: number, forceRefresh = false): void {
    this.lastQueryLat  = lat;
    this.lastQueryLng  = lng;
    this.lastQueryTime = Date.now();

    this.http
      .post<CoverageResult>(`${this.apiUrl}/shadow-map/query`, { lat, lng, forceRefresh })
      .subscribe({
        next:  (result) => this.coverageSubject.next(result),
        error: () => {},
      });
  }

  // ── Current snapshot (for Phase 4 to read synchronously) ─────────────────

  getCurrentCoverage(): CoverageResult | null {
    return this.coverageSubject.value;
  }
}

// ── Haversine helper (client-side, no imports needed) ────────────────────────

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6_371_000;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dO = (lng2 - lng1) * Math.PI / 180;
  const a  =
    Math.sin(dL / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dO / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
