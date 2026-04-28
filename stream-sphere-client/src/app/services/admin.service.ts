import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SessionGroupStats {
  count:              number;
  avgPhi:             number | null;
  avgVmaf:            number | null;
  avgSigmaVmaf:       number | null;
  avgTotalStallMs:    number | null;
  avgStallCount:      number | null;
  avgBufferSec:       number | null;
}

export interface RecentSession {
  sessionId:    string;
  startedAt:    string;
  endedAt:      string | null;
  videoId:      string;
  genabrActive: boolean;
  phiScore:     number | null;
  avgVmaf:      number | null;
  sigmaVmaf:    number | null;
  totalStallMs: number;
  stallCount:   number;
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
    scannedCount:       number;
    deadZoneCount:      number;
    deadZoneRate:       number | null;
    feasibleCount:      number;
    feasibilityRate:    number | null;
    avgEntrySeconds:    number | null;
    avgDurationSeconds: number | null;
  };
  recentDecisions: OracleRecentDecision[];
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
  genabr: {
    totalSessions:  number;
    withGenabr:     SessionGroupStats;
    withoutGenabr:  SessionGroupStats;
    baselineIsReal: boolean;   // true = real recorded data; false = hardcoded estimates
    recentSessions: RecentSession[];
  } | null;
  oracle: OracleInsights | null;
  errors: { cloudfront: string | null; s3: string | null; genabr: string | null; oracle: string | null };
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
