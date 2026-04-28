import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { distinctUntilChanged, filter } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ShadowMapService } from './shadow-map.service';
import { GuardTierService } from './guard-tier.service';

export interface BufferTarget {
  max_buffer_length:     number;
  max_max_buffer_length: number;
  risk_score:            number;
  recommendation:        'normal' | 'prebuffer_moderate' | 'prebuffer_aggressive';
  horizon_seconds:       number;
}

export interface InferenceResult {
  buffer_target:    BufferTarget;
  tier_used:        'guard' | 'student' | 'oracle';
  confidence:       number;
  oracle_triggered: boolean;
  oracle_pending:   boolean;   // true = Oracle computing in background; result arrives next cycle
  oracle_reason:    string | null;
  oracle_reasoning: string | null;   // full LLM explanation
}

const POLL_INTERVAL_MS    = 25_000;
const DOWNLINK_HISTORY_N  = 5;   // keep last 5 downlink readings for Oracle
const STALL_WINDOW_MS     = 60_000;
const NORMAL_LINGER_MS    = 4_000; // keep badge visible 4s after recommendation returns to normal

function recommendationKey(t: BufferTarget): string { return t.recommendation; }

@Injectable({ providedIn: 'root' })
export class PredictionService implements OnDestroy {
  private apiUrl = environment.apiUrl;

  private targetSubject    = new BehaviorSubject<BufferTarget | null>(null);
  private inferenceSubject = new BehaviorSubject<InferenceResult | null>(null);

  bufferTarget$:   Observable<BufferTarget | null>   = this.targetSubject.asObservable();
  /** Full inference result — used by the player to show the GenABR activity badge. */
  inference$:      Observable<InferenceResult | null> = this.inferenceSubject.asObservable();

  bufferTargetChanged$: Observable<BufferTarget> = this.bufferTarget$.pipe(
    filter((t): t is BufferTarget => t !== null),
    distinctUntilChanged((a, b) => recommendationKey(a) === recommendationKey(b)),
  );

  private pollTimer:   ReturnType<typeof setInterval> | null = null;
  private coverageSub: Subscription | null = null;

  // Position (set by TelemetryService)
  private lat:      number | null = null;
  private lng:      number | null = null;
  private heading:  number = 0;
  private speedKmh: number = 0;

  // Context for Guard + Oracle tiers
  private connectionType:    string | null = null;
  private bufferLevelSec:    number | null = null;
  private downlinkHistory:   number[] = [];
  private recentStallTimes:  number[] = [];  // timestamps of stalls
  private currentBitrateKbps: number | null = null;  // current video stream bitrate

  // Phase 6 — tracks whether GenABR has ever intervened this session
  genabrWasActive = false;

  // Current session id — forwarded to Oracle for per-session LLM log linkage
  private sessionId: string | null = null;

  constructor(
    private http: HttpClient,
    private shadowMap: ShadowMapService,
    private guard: GuardTierService,
  ) {}

  // ── Session lifecycle ─────────────────────────────────────────────────────

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  startPredicting(): void {
    this.stopPredicting();
    this.genabrWasActive = false;

    this.coverageSub = this.shadowMap.coverage$.subscribe(coverage => {
      if (coverage && this.lat !== null) this.fetchTarget();
    });

    this.pollTimer = setInterval(() => {
      if (this.lat !== null) this.fetchTarget();
    }, POLL_INTERVAL_MS);

    if (this.lat !== null) this.fetchTarget();
  }

  stopPredicting(): void {
    if (this.pollTimer)  { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.coverageSub) { this.coverageSub.unsubscribe(); this.coverageSub = null; }
    this.targetSubject.next(null);
    this.inferenceSubject.next(null);
    this.currentBitrateKbps = null;
  }

  ngOnDestroy(): void { this.stopPredicting(); }

  // ── External updates from TelemetryService / Player ──────────────────────

  updatePosition(lat: number, lng: number, heading: number, speedKmh: number): void {
    const isFirstFix = this.lat === null;
    this.lat = lat; this.lng = lng;
    this.heading = heading; this.speedKmh = speedKmh;

    // Prewarm: fire an immediate fetch the first time we get a GPS fix while predicting.
    // This warms the Redis cache so the 25s cycle returns Oracle (not Student) results sooner.
    if (isFirstFix && this.pollTimer !== null) {
      this.fetchTarget();
    }
  }

  updateNetworkContext(
    connectionType:  string | null,
    downlinkMbps:    number | null,
    bufferLevelSec:  number | null,
    bitrateKbps:     number | null = null,
  ): void {
    this.connectionType = connectionType;
    this.bufferLevelSec = bufferLevelSec;

    if (bitrateKbps !== null) {
      this.currentBitrateKbps = bitrateKbps;
    }

    if (downlinkMbps !== null) {
      this.downlinkHistory.push(downlinkMbps);
      if (this.downlinkHistory.length > DOWNLINK_HISTORY_N) {
        this.downlinkHistory.shift();
      }
    }
  }

  notifyStall(): void {
    this.recentStallTimes.push(Date.now());
  }

  // ── Core fetch with Guard check ───────────────────────────────────────────

  private fetchTarget(): void {
    if (this.lat === null || this.lng === null) return;

    // Purge stall timestamps older than 60s
    const now = Date.now();
    this.recentStallTimes = this.recentStallTimes.filter(t => now - t < STALL_WINDOW_MS);

    // Guard tier — evaluate locally first
    const guardDecision = this.guard.evaluate({
      connectionType:   this.connectionType,
      downlinkMbps:     this.downlinkHistory.length > 0
        ? this.downlinkHistory[this.downlinkHistory.length - 1]
        : null,
      bufferLevelSec:   this.bufferLevelSec,
      recentStallCount: this.recentStallTimes.length,
    });

    if (guardDecision.pass) {
      // Guard clears it — no backend call needed, keep current target
      return;
    }

    // Current bandwidth = latest downlink reading
    const bandwidthMbps = this.downlinkHistory.length > 0
      ? this.downlinkHistory[this.downlinkHistory.length - 1]
      : 0;

    // Student / Oracle — call backend
    this.http.post<InferenceResult & { enabled?: boolean }>(`${this.apiUrl}/genabr/decision`, {
      lat:              this.lat,
      lng:              this.lng,
      heading:          this.heading,
      speed_kmh:        this.speedKmh,
      recent_downlinks: this.downlinkHistory,
      session_id:       this.sessionId,
      bitrate_kbps:     this.currentBitrateKbps ?? 1500,
      bandwidth_mbps:   bandwidthMbps,
    }).subscribe({
      next: (result) => {
        // Admin has globally disabled GenABR — stop the polling loop and
        // clear the badge so HLS.js takes over with its own ABR algorithm.
        if (result.enabled === false) {
          this.stopPredicting();
          return;
        }
        this.targetSubject.next(result.buffer_target);
        this.inferenceSubject.next(result);
        // Mark genabr as active if we actually changed the buffer target
        if (result.buffer_target.recommendation !== 'normal') {
          this.genabrWasActive = true;
        }
      },
      error: () => {},
    });
  }

  getCurrentTarget(): BufferTarget | null { return this.targetSubject.value; }
}
