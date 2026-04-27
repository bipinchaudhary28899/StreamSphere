import { computeBufferTarget, BufferTarget } from './predictionCone.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InferenceResult {
  buffer_target:    BufferTarget;
  tier_used:        'student' | 'oracle';
  confidence:       number;   // 0–1, Student's certainty in its answer
  oracle_triggered: boolean;
  oracle_reason:    string | null;
}

// ── Oracle rate limiter (in-memory, resets on server restart) ─────────────────
// Prevents cost explosion when a real LLM is wired in later.

const oracleCallLog = new Map<string, number[]>(); // userId → timestamps
const ORACLE_MAX_PER_MIN = 10;

function oracleAllowed(userId: string): boolean {
  const now   = Date.now();
  const calls = (oracleCallLog.get(userId) ?? []).filter(t => now - t < 60_000);
  if (calls.length >= ORACLE_MAX_PER_MIN) return false;
  calls.push(now);
  oracleCallLog.set(userId, calls);
  return true;
}

// ── Student tier — confidence scoring ────────────────────────────────────────
// Risk thresholds sit at 0.20 (normal→moderate) and 0.45 (moderate→aggressive).
// Confidence is low when risk is near a boundary; high when it's deep inside
// a zone.  We use the normalised distance to the nearest boundary.

const BOUNDARY_1 = 0.20;
const BOUNDARY_2 = 0.45;
const HALF_ZONE  = 0.125; // ~half the smallest zone width (0.20/2 = 0.10)

function studentConfidence(riskScore: number): number {
  const d1 = Math.abs(riskScore - BOUNDARY_1);
  const d2 = Math.abs(riskScore - BOUNDARY_2);
  const nearestBoundary = Math.min(d1, d2);
  return Math.min(nearestBoundary / HALF_ZONE, 1.0);
}

// ── Oracle tier — enhanced heuristic ─────────────────────────────────────────
// Triggered when Student confidence < 0.60.
// Applies contextual adjustments: speed class, signal trend, time of day.
// Architecture is intentionally decoupled so a real LLM can replace this
// heuristic in a future version with no changes to callers.

interface OracleContext {
  riskScore:       number;
  speedKmh:        number;
  recentDownlinks: number[];   // last N downlink_mbps readings
}

function oracleAdjust(ctx: OracleContext): { adjustedRisk: number; reason: string } {
  let risk   = ctx.riskScore;
  const reasons: string[] = [];

  // Speed class: highway driving = higher uncertainty → push risk up slightly
  if (ctx.speedKmh > 80) {
    risk += 0.08;
    reasons.push('highway_speed');
  } else if (ctx.speedKmh > 40) {
    risk += 0.04;
    reasons.push('urban_speed');
  }

  // Signal trend from recent downlinks
  if (ctx.recentDownlinks.length >= 3) {
    const recent = ctx.recentDownlinks.slice(-3);
    const trend  = recent[recent.length - 1] - recent[0]; // positive = improving
    if (trend < -2) {
      // Signal dropping fast → more aggressive prebuffer
      risk += 0.12;
      reasons.push('signal_degrading');
    } else if (trend > 2) {
      // Signal improving → can relax slightly
      risk = Math.max(0, risk - 0.05);
      reasons.push('signal_recovering');
    }
  }

  // Time-of-day: peak hours (7–9 AM, 5–8 PM) → networks more congested
  const hour = new Date().getUTCHours();
  const isPeak = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20);
  if (isPeak) {
    risk += 0.05;
    reasons.push('peak_hours');
  }

  return {
    adjustedRisk: Math.min(Math.max(risk, 0), 1),
    reason: reasons.join('+') || 'no_adjustment',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runInference(
  lat: number,
  lng: number,
  heading: number,
  speedKmh: number,
  recentDownlinks: number[] = [],
  userId = 'anon',
): Promise<InferenceResult> {

  // Phase 4: compute raw prediction cone risk + base buffer target
  const coneResult = await computeBufferTarget(lat, lng, heading, speedKmh);
  const riskScore  = coneResult.risk_score;

  // Student tier
  const confidence = studentConfidence(riskScore);

  if (confidence >= 0.60) {
    return {
      buffer_target:    coneResult,
      tier_used:        'student',
      confidence,
      oracle_triggered: false,
      oracle_reason:    null,
    };
  }

  // Oracle tier — only if rate limit allows
  if (!oracleAllowed(userId)) {
    // Rate limited → fall back to Student's answer
    return {
      buffer_target:    coneResult,
      tier_used:        'student',
      confidence,
      oracle_triggered: false,
      oracle_reason:    'rate_limited',
    };
  }

  const { adjustedRisk, reason } = oracleAdjust({
    riskScore,
    speedKmh,
    recentDownlinks,
  });

  // Re-map adjusted risk → buffer target
  const oracleTarget: BufferTarget = {
    ...coneResult,
    risk_score: adjustedRisk,
    ...riskToBuffer(adjustedRisk),
  };

  return {
    buffer_target:    oracleTarget,
    tier_used:        'oracle',
    confidence:       1 - confidence, // Oracle uncertainty is inverse of Student's
    oracle_triggered: true,
    oracle_reason:    reason,
  };
}

// ── Shared risk → buffer mapping (mirrors predictionCone.service.ts) ──────────

function riskToBuffer(risk: number): Pick<
  BufferTarget,
  'max_buffer_length' | 'max_max_buffer_length' | 'recommendation'
> {
  if (risk >= 0.45) return { max_buffer_length: 30, max_max_buffer_length: 60, recommendation: 'prebuffer_aggressive' };
  if (risk >= 0.20) return { max_buffer_length: 20, max_max_buffer_length: 45, recommendation: 'prebuffer_moderate' };
  return                  { max_buffer_length: 10, max_max_buffer_length: 30, recommendation: 'normal' };
}
