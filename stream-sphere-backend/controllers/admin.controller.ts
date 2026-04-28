import { Request, Response } from 'express';
import { getCloudFrontStats, getS3StorageStats, FREE_TIER } from '../services/cloudwatch.service';
import { redisService, CK } from '../services/redis.service';
import { Video }           from '../models/video';
import { User }            from '../models/user';
import { StreamingSession } from '../models/streamingSession';
import { OracleDecision }  from '../models/oracleDecision';

let Comment: any;
try { Comment = require('../models/comment').Comment; } catch { Comment = null; }

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function today(): string {
  const d   = new Date();
  const mon = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${mon}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ── GenABR session comparison ─────────────────────────────────────────────────

interface GroupedSessionStats {
  count:              number;
  avgPhi:             number | null;
  avgVmaf:            number | null;
  avgSigmaVmaf:       number | null;
  avgTotalStallMs:    number | null;
  avgStallCount:      number | null;
  avgBufferSec:       number | null;
}

/** Empty baseline — all metrics null so the dashboard shows dashes until real
 *  sessions are collected with GenABR toggled OFF. */
const EMPTY_BASELINE: GroupedSessionStats = {
  count:           0,
  avgPhi:          null,
  avgVmaf:         null,
  avgSigmaVmaf:    null,
  avgTotalStallMs: null,
  avgStallCount:   null,
  avgBufferSec:    null,
};

async function getGenabrStats(): Promise<{
  totalSessions:  number;
  withGenabr:     GroupedSessionStats;
  withoutGenabr:  GroupedSessionStats;
  baselineIsReal: boolean;
  recentSessions: any[];
}> {
  const [aggResult, recentSessions] = await Promise.all([
    StreamingSession.aggregate([
      {
        $addFields: {
          stallCount: { $size: '$stall_events' },
        },
      },
      {
        $group: {
          _id:             '$genabr_active',
          count:           { $sum: 1 },
          avgPhi:          { $avg: '$phi_score' },
          avgVmaf:         { $avg: '$avg_vmaf' },
          avgSigmaVmaf:    { $avg: '$sigma_vmaf' },
          avgTotalStallMs: { $avg: '$total_stall_ms' },
          avgStallCount:   { $avg: '$stallCount' },
          avgBufferSec:    { $avg: '$avg_buffer_sec' },
        },
      },
    ]),

    StreamingSession.find(
      { ended_at: { $ne: null } },
      {
        session_id:      1,
        started_at:      1,
        ended_at:        1,
        video_id:        1,
        genabr_active:   1,
        phi_score:       1,
        avg_vmaf:        1,
        sigma_vmaf:      1,
        total_stall_ms:  1,
        stall_events:    1,
      },
    )
      .sort({ started_at: -1 })
      .limit(10)
      .lean(),
  ]);

  function toGroup(row: any): GroupedSessionStats {
    return {
      count:           row?.count          ?? 0,
      avgPhi:          row?.avgPhi         ?? null,
      avgVmaf:         row?.avgVmaf        ?? null,
      avgSigmaVmaf:    row?.avgSigmaVmaf   ?? null,
      avgTotalStallMs: row?.avgTotalStallMs ?? null,
      avgStallCount:   row?.avgStallCount  ?? null,
      avgBufferSec:    row?.avgBufferSec   ?? null,
    };
  }

  const withRow    = aggResult.find((r: any) => r._id === true);
  const withoutRow = aggResult.find((r: any) => r._id === false || r._id === null);
  const total      = (withRow?.count ?? 0) + (withoutRow?.count ?? 0);

  // Use real DB data when baseline sessions exist; otherwise show nulls (dashes).
  const hasRealBaseline = (withoutRow?.count ?? 0) > 0;
  const withoutGenabr   = hasRealBaseline ? toGroup(withoutRow) : EMPTY_BASELINE;

  return {
    totalSessions:    total,
    withGenabr:       toGroup(withRow),
    withoutGenabr,
    baselineIsReal:   hasRealBaseline,   // tells the frontend which label to show
    recentSessions: recentSessions.map((s: any) => ({
      sessionId:    s.session_id,
      startedAt:    s.started_at,
      endedAt:      s.ended_at,
      videoId:      s.video_id,
      genabrActive: s.genabr_active,
      phiScore:     s.phi_score,
      avgVmaf:      s.avg_vmaf,
      sigmaVmaf:    s.sigma_vmaf,
      totalStallMs: s.total_stall_ms,
      stallCount:   (s.stall_events ?? []).length,
    })),
  };
}

// ── Oracle Engine Insights ────────────────────────────────────────────────────

async function getOracleInsights(): Promise<{
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
  byRecommendation: Array<{ label: string; count: number; pct: number }>;
  bySpeedCategory:  Array<{ label: string; count: number; pct: number }>;
  byTriggerReason:  Array<{ label: string; count: number; pct: number }>;
  corridorStats: {
    scannedCount:       number;
    deadZoneCount:      number;
    deadZoneRate:       number | null;
    feasibleCount:      number;
    feasibilityRate:    number | null;
    avgEntrySeconds:    number | null;
    avgDurationSeconds: number | null;
  };
  recentDecisions: Array<{
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
  }>;
}> {
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const [
    totalStats,
    byRec,
    bySpeed,
    byReason,
    corridorAgg,
    recent,
  ] = await Promise.all([

    // ── Overall summary ───────────────────────────────────────────────────
    OracleDecision.aggregate([
      { $match: { timestamp: { $gte: since30d } } },
      {
        $group: {
          _id: null,
          total:                  { $sum: 1 },
          llmSuccessCount:        { $sum: { $cond: [{ $eq: ['$llm_failed', false] }, 1, 0] } },
          divergedCount:          { $sum: { $cond: ['$diverged', 1, 0] } },
          avgStudentConf:         { $avg: '$student_conf' },
          avgOracleConf:          { $avg: '$oracle_confidence' },
          avgStudentRisk:         { $avg: '$student_risk' },
          avgOracleRisk:          { $avg: '$oracle_risk' },
          totalPromptTokens:      { $sum: { $ifNull: ['$prompt_tokens', 0] } },
          totalCompletionTokens:  { $sum: { $ifNull: ['$completion_tokens', 0] } },
        },
      },
    ]),

    // ── By recommendation ─────────────────────────────────────────────────
    OracleDecision.aggregate([
      { $match: { timestamp: { $gte: since30d } } },
      { $group: { _id: '$recommendation', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    // ── By speed category ─────────────────────────────────────────────────
    OracleDecision.aggregate([
      { $match: { timestamp: { $gte: since30d } } },
      { $group: { _id: '$speed_category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    // ── By trigger reason (top 8) ─────────────────────────────────────────
    // oracle_reason is a '+'-joined string like "highway_speed+signal_degrading"
    // Split it so each tag is counted individually.
    OracleDecision.aggregate([
      { $match: { timestamp: { $gte: since30d }, oracle_reason: { $nin: [null, '', 'no_adjustment'] } } },
      { $project: { tags: { $split: ['$oracle_reason', '+'] } } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),

    // ── Corridor scanner stats ────────────────────────────────────────────
    OracleDecision.aggregate([
      { $match: { timestamp: { $gte: since30d }, has_dead_zone: { $ne: null } } },
      {
        $group: {
          _id:                 null,
          scannedCount:        { $sum: 1 },
          deadZoneCount:       { $sum: { $cond: ['$has_dead_zone', 1, 0] } },
          feasibleCount:       { $sum: { $cond: ['$corridor_feasible', 1, 0] } },
          avgEntrySeconds:     { $avg: { $cond: ['$has_dead_zone', '$dead_zone_entry_sec', null] } },
          avgDurationSeconds:  { $avg: { $cond: ['$has_dead_zone', '$dead_zone_duration_sec', null] } },
        },
      },
    ]),

    // ── Recent 10 decisions ───────────────────────────────────────────────
    OracleDecision.find(
      { timestamp: { $gte: since30d } },
      {
        session_id: 1, timestamp: 1, speed_kmh: 1, speed_category: 1,
        student_risk: 1, oracle_risk: 1, recommendation: 1,
        reasoning: 1, diverged: 1, oracle_reason: 1,
        has_dead_zone: 1, dead_zone_entry_sec: 1, dead_zone_duration_sec: 1,
        corridor_feasible: 1, llm_failed: 1,
      },
    )
      .sort({ timestamp: -1 })
      .limit(10)
      .lean(),
  ]);

  const t    = totalStats[0];
  const corr = corridorAgg[0];
  const total = t?.total ?? 0;

  function toPct(items: any[]): Array<{ label: string; count: number; pct: number }> {
    const sum = items.reduce((s, r) => s + (r.count ?? 0), 0);
    return items.map(r => ({
      label: r._id ?? 'unknown',
      count: r.count ?? 0,
      pct:   sum > 0 ? Math.round((r.count / sum) * 100) : 0,
    }));
  }

  return {
    last30dSummary: {
      totalCalls:             total,
      llmSuccessRate:         total > 0 ? Math.round((t.llmSuccessCount / total) * 100) : null,
      divergenceRate:         total > 0 ? Math.round((t.divergedCount   / total) * 100) : null,
      avgStudentConf:         t?.avgStudentConf  ?? null,
      avgOracleConf:          t?.avgOracleConf   ?? null,
      avgRiskShift:           (t?.avgOracleRisk != null && t?.avgStudentRisk != null)
                                ? Math.round((t.avgOracleRisk - t.avgStudentRisk) * 1000) / 1000
                                : null,
      totalPromptTokens:      t?.totalPromptTokens     ?? 0,
      totalCompletionTokens:  t?.totalCompletionTokens ?? 0,
    },
    byRecommendation: toPct(byRec),
    bySpeedCategory:  toPct(bySpeed),
    byTriggerReason:  toPct(byReason),
    corridorStats: {
      scannedCount:       corr?.scannedCount      ?? 0,
      deadZoneCount:      corr?.deadZoneCount      ?? 0,
      deadZoneRate:       corr?.scannedCount > 0
                            ? Math.round((corr.deadZoneCount / corr.scannedCount) * 100)
                            : null,
      feasibleCount:      corr?.feasibleCount      ?? 0,
      feasibilityRate:    corr?.deadZoneCount > 0
                            ? Math.round((corr.feasibleCount / corr.deadZoneCount) * 100)
                            : null,
      avgEntrySeconds:    corr?.avgEntrySeconds    ?? null,
      avgDurationSeconds: corr?.avgDurationSeconds ?? null,
    },
    recentDecisions: recent.map((d: any) => ({
      sessionId:           d.session_id   ?? null,
      timestamp:           d.timestamp?.toISOString?.() ?? '',
      speedKmh:            d.speed_kmh    ?? 0,
      speedCategory:       d.speed_category ?? null,
      studentRisk:         d.student_risk  ?? 0,
      oracleRisk:          d.oracle_risk   ?? 0,
      recommendation:      d.recommendation ?? '',
      reasoning:           d.reasoning     ?? '',
      diverged:            d.diverged      ?? false,
      oracleReason:        d.oracle_reason ?? null,
      hasDeadZone:         d.has_dead_zone        ?? null,
      deadZoneEntrySec:    d.dead_zone_entry_sec   ?? null,
      deadZoneDurationSec: d.dead_zone_duration_sec ?? null,
      corridorFeasible:    d.corridor_feasible     ?? null,
      llmFailed:           d.llm_failed   ?? false,
    })),
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

// ── GenABR Global On/Off Flag ─────────────────────────────────────────────────

/** GET /api/admin/genabr-status  (authenticated, any user)
 *  Returns the current global GenABR enabled state.
 *  Defaults to TRUE if the Redis key has never been set. */
export async function getGenabrStatusController(_req: Request, res: Response): Promise<void> {
  const stored = await redisService.get<boolean>(CK.genabrEnabled());
  // null means key was never written → treat as enabled (default ON)
  res.json({ enabled: stored !== false });
}

/** POST /api/admin/genabr-toggle  (admin only)
 *  Body: { enabled: boolean }
 *  Persists the flag to Redis with no TTL so it survives server restarts. */
export async function toggleGenabrController(req: Request, res: Response): Promise<void> {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled (boolean) is required' });
    return;
  }
  await redisService.setPersistent(CK.genabrEnabled(), enabled);
  const actor = (req as any).user?.email ?? 'unknown';
  console.log(`[Admin] GenABR globally ${enabled ? 'ENABLED ✅' : 'DISABLED 🔴'} by ${actor}`);
  res.json({ enabled });
}

// ── Main stats controller ─────────────────────────────────────────────────────

export async function adminStatsController(req: Request, res: Response): Promise<void> {
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  const period         = currentPeriod();

  const [
    cfStats, s3Stats, s3UploadsMonth, apiMonth, apiToday,
    videoCount, userCount, commentCount, genabrStats, oracleInsights,
  ] = await Promise.allSettled([
    distributionId ? getCloudFrontStats(distributionId) : Promise.resolve(null),
    getS3StorageStats(),
    redisService.getCounter(`ss:stats:s3uploads:monthly:${period}`),
    redisService.getCounter(`ss:stats:api:monthly:${period}`),
    redisService.getCounter(`ss:stats:api:daily:${today()}`),
    Video.countDocuments(),
    User.countDocuments(),
    Comment ? Comment.countDocuments() : Promise.resolve(0),
    getGenabrStats(),
    getOracleInsights(),
  ]);

  const cf       = cfStats.status        === 'fulfilled' ? cfStats.value        : null;
  const s3       = s3Stats.status        === 'fulfilled' ? s3Stats.value        : null;
  const uploads  = s3UploadsMonth.status === 'fulfilled' ? s3UploadsMonth.value : 0;
  const apiMo    = apiMonth.status       === 'fulfilled' ? apiMonth.value       : 0;
  const apiDay   = apiToday.status       === 'fulfilled' ? apiToday.value       : 0;
  const videos   = videoCount.status     === 'fulfilled' ? videoCount.value     : 0;
  const users    = userCount.status      === 'fulfilled' ? userCount.value      : 0;
  const comments = commentCount.status   === 'fulfilled' ? commentCount.value   : 0;
  const genabr   = genabrStats.status    === 'fulfilled' ? genabrStats.value    : null;
  const oracle   = oracleInsights.status === 'fulfilled' ? oracleInsights.value : null;

  res.json({
    period,
    generatedAt: new Date().toISOString(),
    cloudfront: {
      distributionConfigured: !!distributionId,
      requests:       cf?.requests      ?? null,
      dataTransferGB: cf?.dataTransferGB ?? null,
    },
    s3: {
      storageGB:   s3?.storageGB   ?? null,
      objectCount: s3?.objectCount ?? null,
      putRequests: uploads,
    },
    backend: { apiRequestsMonth: apiMo, apiRequestsToday: apiDay },
    app: { videos, users, comments },
    limits: FREE_TIER,
    genabr,
    oracle,
    errors: {
      cloudfront:     cfStats.status === 'rejected'       ? String(cfStats.reason)       : null,
      s3:             s3Stats.status === 'rejected'        ? String(s3Stats.reason)        : null,
      genabr:         genabrStats.status === 'rejected'   ? String((genabrStats as any).reason)   : null,
      oracle:         oracleInsights.status === 'rejected' ? String((oracleInsights as any).reason) : null,
    },
  });
}
