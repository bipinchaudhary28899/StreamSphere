import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ── 3-Segment Research Comparison ────────────────────────────────────────────

export interface SegmentStats {
  count:              number;
  avgPhi:             number | null;
  avgVmaf:            number | null;
  avgSigmaVmaf:       number | null;
  avgTotalStallMs:    number | null;
  avgStallCount:      number | null;
  avgBufferSec:       number | null;
  avgOracleCostUsd:   number | null;
  uniqueRouteCount:   number;
}

export interface SegmentData {
  withGenabr:        SegmentStats;
  withoutGenabr:     SegmentStats;
  baselineAvailable: boolean;
}

export interface SegmentedComparison {
  mobile:            SegmentData;
  mobilePoorSignal:  SegmentData;
  stationaryGood:    SegmentData;
  recentSessions:    RecentSession[];
}

export interface RecentSession {
  sessionId:     string;
  startedAt:     string;
  endedAt:       string | null;
  videoId:       string;
  genabrActive:  boolean;
  phiScore:      number | null;
  avgVmaf:       number | null;
  sigmaVmaf:     number | null;
  totalStallMs:  number;
  stallCount:    number;
  oracleCostUsd: number | null;
  routeId:       string | null;
  tierCounts:    { guard: number; student: number; oracle: number };
}

// ── Oracle Insights ───────────────────────────────────────────────────────────

export interface OracleTriggerItem {
  label: string;
  count: number;
  pct:   number;
}

export interface OracleRecentDecision {
  sessionId:           string | null;
  timestamp:           string;
  speedKmh:            number;
  speedCategory:       string | null;
  studentRisk:         number;
  oracleRisk:          number;
  recommendation:      string;
  reasoning:           string;
  diverged:            boolean;
  oracleReason:        string | null;
  hasDeadZone:         boolean | null;
  deadZoneEntrySec:    number | null;
  deadZoneDurationSec: number | null;
  corridorFeasible:    boolean | null;
  llmFailed:           boolean;
}

export interface OracleInsights {
  last30dSummary: {
    totalCalls:             number;
    llmSuccessRate:         number | null;
    divergenceRate:         number | null;
    avgStudentConf:         number | null;
    avgOracleConf:          number | null;
    avgRiskShift:           number | null;
    totalPromptTokens:      number;
    totalCompletionTokens:  number;
  };
  byRecommendation: OracleTriggerItem[];
  bySpeedCategory:  OracleTriggerItem[];
  byTriggerReason:  OracleTriggerItem[];
  corridorStats: {
    scannedCount:           number;
    deadZoneCount:          number;
    deadZoneRate:           number | null;
    feasibleCount:          number;
    feasibilityRate:        number | null;     // now bounded 0–100
    avgEntrySeconds:        number | null;
    avgDurationSeconds:     number | null;
    avgProactiveLeadTime:   number | null;     // paper Section VII.C.4
    proactiveTriggerCount:  number;
  };
  recentDecisions: OracleRecentDecision[];
}

// ── Student Network Events ────────────────────────────────────────────────────

export interface StudentNetworkItem {
  label: string;
  count: number;
  pct:   number;
}

export interface StudentInsights {
  last30dSummary: {
    totalDecisions:     number;
    oraclePendingCount: number;
    avgConfidence:      number | null;
    avgEffectiveRisk:   number | null;
  };
  byNetworkFactor:  StudentNetworkItem[];
  byConnectionType: StudentNetworkItem[];
}

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
  comparison:     SegmentedComparison   | null;
  oracle:         OracleInsights        | null;
  student:        StudentInsights       | null;
  uploadTimings:  UploadTimingVideo[]   | null;
  errors: {
    cloudfront:  string | null;
    s3:          string | null;
    comparison:  string | null;
    oracle:      string | null;
    student:     string | null;
  };
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private base = environment.apiUrl;
  constructor(private http: HttpClient) {}

  getStats(): Observable<AdminStats> {
    return this.http.get<AdminStats>(`${this.base}/admin/stats`);
  }

  /** Returns the current global GenABR enabled state (any authenticated user). */
  getGenabrEnabled(): Observable<{ enabled: boolean }> {
    return this.http.get<{ enabled: boolean }>(`${this.base}/admin/genabr-status`);
  }

  /** Admin-only: toggle GenABR on or off for all users globally. */
  setGenabrEnabled(enabled: boolean): Observable<{ enabled: boolean }> {
    return this.http.post<{ enabled: boolean }>(`${this.base}/admin/genabr-toggle`, { enabled });
  }
}
