import { StreamingSession } from '../models/streamingSession';
import { TelemetryPing }    from '../models/telemetryPing';
import { updateRadioMapFromSession } from './shadowMap.service';

// ── VMAF estimation from bitrate ──────────────────────────────────────────────

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

// ── QoE-to-Cost metric Φ ──────────────────────────────────────────────────────
// Φ = (avg_VMAF − α·σ_VMAF − β·N_stall·T_stall) / C_session
//
// α = 0.30 — penalises VMAF variance
// β = 0.05 — penalises each second of accumulated stall time
// C_session — session duration in minutes

const ALPHA = 0.30;
const BETA  = 0.05;

export function computePhi(
  avgVmaf:            number,
  sigmaVmaf:          number,
  nStall:             number,
  totalStallSec:      number,
  sessionDurationMin: number,
): number {
  const C = Math.max(sessionDurationMin, 0.5);
  return (avgVmaf - ALPHA * sigmaVmaf - BETA * nStall * totalStallSec) / C;
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

  // ── Duration + Phi ────────────────────────────────────────────────────────
  const startedAt   = new Date(s.started_at).getTime();
  const endedAt     = Date.now();
  const durationMin = (endedAt - startedAt) / 60_000;
  const phi         = computePhi(avgVmaf, sigmaVmaf, nStall, totalStallSec, durationMin);

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
