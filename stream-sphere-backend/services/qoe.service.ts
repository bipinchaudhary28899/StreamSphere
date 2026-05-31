import { StreamingSession } from '../models/streamingSession';
import { TelemetryPing }    from '../models/telemetryPing';
import { OracleDecision }   from '../models/oracleDecision';
import { updateRadioMapFromSession } from './shadowMap.service';
import { tileId } from '../utils/geo';

// ── VMAF estimation from bitrate ──────────────────────────────────────────────
// NOTE: This is a bitrate→VMAF lookup proxy, NOT real Netflix VMAF SDK output.
// The paper labels this "VMAF-proxy"; the dashboard surfaces it as
// "Estimated video quality" to be honest about its provenance. Replace with
// real per-frame VMAF computation (ffmpeg + libvmaf) before publication.

export function estimateVmaf(bitrateKbps: number): number {
  if (bitrateKbps >= 8000) return 93;
  if (bitrateKbps >= 5000) return 90;
  if (bitrateKbps >= 3000) return 85;
  if (bitrateKbps >= 1500) return 78;
  if (bitrateKbps >= 800)  return 70;
  if (bitrateKbps >= 400)  return 62;
  if (bitrateKbps >= 200)  return 52;
  return 42;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean     = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── QoE-to-Cost metric Φ (paper Eq. 9) ────────────────────────────────────────
// Φ = (avg_VMAF − α·σ_VMAF − β·N_stall·T_stall) / C_session
//
// α = 0.5  — penalises VMAF variance     (per paper)
// β = 20   — penalises stall events × duration (per paper)
// C_session — per-session inference cost in USD
//
// COST FLOOR: Baseline (BOLA/MPC/Pensieve) sessions have C_session = $0, which
// would make Φ undefined. We apply a $0.0001 floor — equivalent to a single
// ~600-token Student-tier inference — so Φ stays finite and the A/B comparison
// remains numerically meaningful. Document this floor when reporting Φ values.

const ALPHA          = 0.5;
const BETA           = 20;
const COST_FLOOR_USD = 0.0001;

// gpt-4o-mini pricing (as of 2024). Update if model or pricing changes.
const PROMPT_RATE_PER_TOKEN     = 0.15  / 1_000_000;   // $0.15 per 1M prompt tokens
const COMPLETION_RATE_PER_TOKEN = 0.60  / 1_000_000;   // $0.60 per 1M completion tokens

export function tokenCostUsd(promptTokens: number, completionTokens: number): number {
  return promptTokens * PROMPT_RATE_PER_TOKEN
       + completionTokens * COMPLETION_RATE_PER_TOKEN;
}

export function computePhi(
  avgVmaf:        number,
  sigmaVmaf:      number,
  nStall:         number,
  totalStallSec:  number,
  costUsd:        number,
): number {
  const C = Math.max(costUsd, COST_FLOOR_USD);
  return (avgVmaf - ALPHA * sigmaVmaf - BETA * nStall * totalStallSec) / C;
}

// Legacy quality-per-minute Φ (kept as secondary diagnostic for stable plots
// during early data collection when most sessions have C_session ≈ floor and
// the Eq. 9 Φ degenerates to "VMAF / floor" for everyone).
export function computePhiPerMinute(
  avgVmaf:            number,
  sigmaVmaf:          number,
  nStall:             number,
  totalStallSec:      number,
  sessionDurationMin: number,
): number {
  const C = Math.max(sessionDurationMin, 0.5);
  return (avgVmaf - 0.30 * sigmaVmaf - 0.05 * nStall * totalStallSec) / C;
}

// ── Session-end QoE computation ───────────────────────────────────────────────

export async function finaliseSession(
  sessionId:    string,
  genabrActive: boolean,
): Promise<void> {
  const session = await StreamingSession.findOne({ session_id: sessionId }).lean();
  if (!session) return;

  const s = session as any;

  // ── Ping aggregation (one query, compute everything in one pass) ──────────
  // Run this BEFORE VMAF computation so bitrate distribution is available as
  // a fallback for sigma_vmaf when bitrate_switches is sparse.
  const pingAgg = await TelemetryPing.aggregate([
    { $match: { session_id: sessionId } },
    {
      $group: {
        _id:              null,
        count:            { $sum: 1 },
        avgBuffer:        { $avg: '$buffer_level_sec' },
        minBuffer:        { $min: '$buffer_level_sec' },
        maxBuffer:        { $max: '$buffer_level_sec' },
        // Count pings where buffer < 0.5s (near-stall) for rebuffer_ratio
        nearStallCount:   { $sum: { $cond: [{ $lt: ['$buffer_level_sec', 0.5] }, 1, 0] } },
        // Bitrate variance: collect all non-null bitrate values
        avgBitrate:       { $avg: '$bitrate_kbps' },
        avgBitrateSq:     { $avg: { $multiply: ['$bitrate_kbps', '$bitrate_kbps'] } },
        // Speeds for movement classification
        speeds:           { $push: '$speed_kmh' },
      },
    },
  ]);

  const agg            = pingAgg[0] ?? null;
  const pingCount      = agg?.count          ?? 0;
  const avgBufferSec   = agg?.avgBuffer       ?? null;
  const minBufferSec   = agg?.minBuffer       ?? null;
  const maxBufferSec   = agg?.maxBuffer       ?? null;
  const rebufferRatio  = pingCount > 0
    ? (agg.nearStallCount / pingCount)
    : null;

  // Population variance from E[X²] - (E[X])²
  const bitrateVariance = (agg?.avgBitrateSq != null && agg?.avgBitrate != null)
    ? Math.max(0, agg.avgBitrateSq - agg.avgBitrate ** 2)
    : null;
  const bitrateStdDev = bitrateVariance != null ? Math.sqrt(bitrateVariance) : 0;

  // ── VMAF timeline ─────────────────────────────────────────────────────────
  // Primary source: bitrate_switches (each switch → one VMAF sample).
  // Fallback: when switches are absent or too few, use the ping-level bitrate
  // distribution (mean ± 1 σ) to produce a realistic sigma_vmaf rather than
  // locking it at zero for stable-quality sessions.
  const vmafValues: number[] = (s.bitrate_switches as any[]).map((sw: any) =>
    estimateVmaf(sw.to_kbps),
  );

  if (vmafValues.length <= 1) {
    // Use ping mean bitrate as the anchor
    const meanKbps = agg?.avgBitrate ?? null;
    if (meanKbps && meanKbps > 0) {
      const baseVmaf = estimateVmaf(Math.round(meanKbps));

      if (vmafValues.length === 0) {
        vmafValues.push(baseVmaf);   // at least one point for avgVmaf
      }

      // Add sigma spread from ping bitrate distribution so stdDev > 0.
      // If bitrate varied across pings (e.g. micro-fluctuations from the
      // network or a GenABR step-down), this produces a non-zero sigma.
      if (bitrateStdDev > 50) {   // threshold: >50 kbps spread is meaningful
        const lowKbps  = Math.max(200, Math.round(meanKbps - bitrateStdDev));
        const highKbps = Math.round(meanKbps + bitrateStdDev);
        vmafValues.push(estimateVmaf(lowKbps), estimateVmaf(highKbps));
      }
    }
  }

  const avgVmaf   = vmafValues.length > 0
    ? vmafValues.reduce((a, b) => a + b, 0) / vmafValues.length
    : 70;
  const sigmaVmaf = stdDev(vmafValues);

  // Movement type from median speed
  let movementType: 'stationary' | 'walking' | 'driving' | null = null;
  if (agg?.speeds?.length > 0) {
    const speeds: number[] = (agg.speeds as (number | null)[]).filter((v): v is number => v !== null);
    if (speeds.length > 0) {
      const medSpeed = median(speeds);
      if (medSpeed < 2)       movementType = 'stationary';
      else if (medSpeed < 10) movementType = 'walking';
      else                    movementType = 'driving';
    }
  }

  // ── Stall stats ───────────────────────────────────────────────────────────
  const nStall        = (s.stall_events as any[]).length;
  const totalStallMs  = s.total_stall_ms ?? 0;
  const totalStallSec = totalStallMs / 1000;

  // ── Per-session Oracle inference cost (USD) ───────────────────────────────
  // Sum tokens across every OracleDecision logged for this session.
  // Empty list (baseline / Student-only) → cost = 0; computePhi applies the
  // $0.0001 floor automatically, so Φ stays finite for comparison.
  const costAgg = await OracleDecision.aggregate([
    { $match: { session_id: sessionId } },
    {
      $group: {
        _id:               null,
        promptTokens:      { $sum: { $ifNull: ['$prompt_tokens',     0] } },
        completionTokens:  { $sum: { $ifNull: ['$completion_tokens', 0] } },
      },
    },
  ]);
  const oracleCostUsd = costAgg[0]
    ? tokenCostUsd(costAgg[0].promptTokens ?? 0, costAgg[0].completionTokens ?? 0)
    : 0;

  // ── Stable route_id from first/last GPS ping (200 m tile granularity) ────
  // Same physical commute (within tile resolution) → same route_id.
  // Used for the paper's "M markers from K unique routes" claim.
  let routeId: string | null = null;
  if (pingCount > 0) {
    const endpoints = await TelemetryPing.aggregate([
      { $match: { session_id: sessionId, lat: { $ne: null }, lng: { $ne: null } } },
      { $sort:  { timestamp: 1 } },
      {
        $group: {
          _id:        null,
          firstLat:   { $first: '$lat' },
          firstLng:   { $first: '$lng' },
          lastLat:    { $last:  '$lat' },
          lastLng:    { $last:  '$lng' },
        },
      },
    ]);
    const e = endpoints[0];
    if (e && e.firstLat != null && e.lastLat != null) {
      const start = tileId(e.firstLat, e.firstLng);
      const end   = tileId(e.lastLat,  e.lastLng);
      // Order endpoints so reverse traversal of the same route hashes equal.
      routeId = start < end ? `${start}→${end}` : `${end}→${start}`;
    }
  }

  // ── Duration + Phi ────────────────────────────────────────────────────────
  const startedAt   = new Date(s.started_at).getTime();
  const endedAt     = Date.now();
  const durationMin = (endedAt - startedAt) / 60_000;
  const phi         = computePhi(avgVmaf, sigmaVmaf, nStall, totalStallSec, oracleCostUsd);

  await StreamingSession.updateOne(
    { session_id: sessionId },
    {
      $set: {
        ended_at:         new Date(),
        avg_vmaf:         Math.round(avgVmaf   * 10) / 10,
        sigma_vmaf:       Math.round(sigmaVmaf * 10) / 10,
        total_stall_ms:   totalStallMs,
        genabr_active:    genabrActive,
        phi_score:        Math.round(phi * 100) / 100,
        oracle_cost_usd:  Math.round(oracleCostUsd * 1_000_000) / 1_000_000, // 6-decimal USD
        route_id:         routeId,
        avg_buffer_sec:   avgBufferSec   !== null ? Math.round(avgBufferSec   * 10) / 10 : null,
        min_buffer_sec:   minBufferSec   !== null ? Math.round(minBufferSec   * 10) / 10 : null,
        max_buffer_sec:   maxBufferSec   !== null ? Math.round(maxBufferSec   * 10) / 10 : null,
        rebuffer_ratio:   rebufferRatio  !== null ? Math.round(rebufferRatio  * 1000) / 1000 : null,
        bitrate_variance: bitrateVariance !== null ? Math.round(bitrateVariance) : null,
        movement_type:    movementType,
      },
    },
  );

  // Aggregate pings into radio_map_cache tiles (fire-and-forget — must complete
  // BEFORE the 2-day TTL deletes the raw pings, which is why it runs at session end).
  updateRadioMapFromSession(sessionId).catch(() => {});
}
