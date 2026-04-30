import { Request, Response } from 'express';
import { getCloudFrontStats, getS3StorageStats, FREE_TIER } from '../services/cloudwatch.service';
import { redisService, CK } from '../services/redis.service';
import { Video }           from '../models/video';
import { User }            from '../models/user';
import { StreamingSession } from '../models/streamingSession';
import { TelemetryPing }   from '../models/telemetryPing';
import { OracleDecision }  from '../models/oracleDecision';
import { StudentDecision } from '../models/studentDecision';

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

// ── GenABR 3-segment research comparison ─────────────────────────────────────

interface SegmentStats {
  count:              number;
  avgPhi:             number | null;
  avgVmaf:            number | null;
  avgSigmaVmaf:       number | null;
  avgTotalStallMs:    number | null;
  avgStallCount:      number | null;
  avgBufferSec:       number | null;
}

interface SegmentData {
  withGenabr:        SegmentStats;
  withoutGenabr:     SegmentStats;
  baselineAvailable: boolean;
}

function emptyStats(): SegmentStats {
  return { count: 0, avgPhi: null, avgVmaf: null, avgSigmaVmaf: null,
           avgTotalStallMs: null, avgStallCount: null, avgBufferSec: null };
}

function toSegmentStats(row: any): SegmentStats {
  return {
    count:           row?.count           ?? 0,
    avgPhi:          row?.avgPhi          ?? null,
    avgVmaf:         row?.avgVmaf         ?? null,
    avgSigmaVmaf:    row?.avgSigmaVmaf    ?? null,
    avgTotalStallMs: row?.avgTotalStallMs ?? null,
    avgStallCount:   row?.avgStallCount   ?? null,
    avgBufferSec:    row?.avgBufferSec    ?? null,
  };
}

async function aggregateSegment(sessionIds: string[]): Promise<SegmentData> {
  if (sessionIds.length === 0) {
    return { withGenabr: emptyStats(), withoutGenabr: emptyStats(), baselineAvailable: false };
  }

  const rows = await StreamingSession.aggregate([
    { $match: { session_id: { $in: sessionIds }, ended_at: { $ne: null } } },
    { $addFields: { stallCount: { $size: '$stall_events' } } },
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
  ]);

  const withRow    = rows.find((r: any) => r._id === true);
  const withoutRow = rows.find((r: any) => r._id === false || r._id === null);

  return {
    withGenabr:        toSegmentStats(withRow),
    withoutGenabr:     toSegmentStats(withoutRow),
    baselineAvailable: (withoutRow?.count ?? 0) > 0,
  };
}

async function getSegmentedComparison(): Promise<{
  mobile:            SegmentData;
  mobilePoorSignal:  SegmentData;
  stationaryGood:    SegmentData;
  recentSessions:    any[];
}> {
  // ── Stage 1: classify session IDs from TelemetryPing aggregation ─────────
  const pingAgg: Array<{
    _id:         string;
    maxSpeed:    number | null;
    avgDownlink: number | null;
    minDownlink: number | null;
  }> = await TelemetryPing.aggregate([
    {
      $group: {
        _id:         '$session_id',
        maxSpeed:    { $max: '$speed_kmh' },
        avgDownlink: { $avg: '$downlink_mbps' },
        minDownlink: { $min: '$downlink_mbps' },
      },
    },
  ]);

  const mobileSessions:           string[] = [];
  const mobilePoorSignalSessions: string[] = [];
  const stationaryGoodSessions:   string[] = [];

  for (const row of pingAgg) {
    const sid         = row._id;
    const maxSpeed    = row.maxSpeed    ?? 0;
    const avgDownlink = row.avgDownlink ?? null;
    const minDownlink = row.minDownlink ?? null;

    const isMobile     = maxSpeed > 5;
    const isPoorSignal = (avgDownlink !== null && avgDownlink < 1.5)
                      || (minDownlink !== null && minDownlink < 0.5);
    const isStationary = maxSpeed <= 5;
    const isGoodSignal = avgDownlink !== null && avgDownlink >= 3.0;

    if (isMobile)                     mobileSessions.push(sid);
    if (isMobile && isPoorSignal)     mobilePoorSignalSessions.push(sid);
    if (isStationary && isGoodSignal) stationaryGoodSessions.push(sid);
  }

  // ── Stage 2: aggregate StreamingSession per segment + recent sessions ────
  const [mobile, mobilePoorSignal, stationaryGood, recentRaw] = await Promise.all([
    aggregateSegment(mobileSessions),
    aggregateSegment(mobilePoorSignalSessions),
    aggregateSegment(stationaryGoodSessions),
    StreamingSession.find(
      { ended_at: { $ne: null } },
      {
        session_id: 1, started_at: 1, ended_at: 1, video_id: 1,
        genabr_active: 1, phi_score: 1, avg_vmaf: 1, sigma_vmaf: 1,
        total_stall_ms: 1, stall_events: 1, tier_counts: 1,
      },
    ).sort({ started_at: -1 }).limit(10).lean(),
  ]);

  return {
    mobile,
    mobilePoorSignal,
    stationaryGood,
    recentSessions: recentRaw.map((s: any) => ({
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
      tierCounts: {
        guard:   s.tier_counts?.guard   ?? 0,
        student: s.tier_counts?.student ?? 0,
        oracle:  s.tier_counts?.oracle  ?? 0,
      },
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

// ── Student Network Events ────────────────────────────────────────────────────

async function getStudentInsights(): Promise<{
  last30dSummary: {
    totalDecisions:     number;
    oraclePendingCount: number;
    avgConfidence:      number | null;
    avgEffectiveRisk:   number | null;
  };
  byNetworkFactor:  Array<{ label: string; count: number; pct: number }>;
  byConnectionType: Array<{ label: string; count: number; pct: number }>;
}> {
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const [totalStats, byFactor, byConn] = await Promise.all([

    // ── Overall summary ───────────────────────────────────────────────────
    StudentDecision.aggregate([
      { $match: { timestamp: { $gte: since30d } } },
      {
        $group: {
          _id:                null,
          total:              { $sum: 1 },
          oraclePendingCount: { $sum: { $cond: ['$oracle_pending', 1, 0] } },
          avgConfidence:      { $avg: '$confidence' },
          avgEffectiveRisk:   { $avg: '$effective_risk' },
        },
      },
    ]),

    // ── By network_factor (top 10) ────────────────────────────────────────
    // network_factors is already an array field — unwind directly.
    StudentDecision.aggregate([
      { $match: { timestamp: { $gte: since30d }, 'network_factors.0': { $exists: true } } },
      { $unwind: '$network_factors' },
      { $group: { _id: '$network_factors', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),

    // ── By connection_type ────────────────────────────────────────────────
    StudentDecision.aggregate([
      { $match: { timestamp: { $gte: since30d }, connection_type: { $nin: [null, ''] } } },
      { $group: { _id: '$connection_type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  const t     = totalStats[0];
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
      totalDecisions:     total,
      oraclePendingCount: t?.oraclePendingCount ?? 0,
      avgConfidence:      t?.avgConfidence      ?? null,
      avgEffectiveRisk:   t?.avgEffectiveRisk   ?? null,
    },
    byNetworkFactor:  toPct(byFactor),
    byConnectionType: toPct(byConn),
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
    videoCount, userCount, commentCount, comparisonResult, oracleInsights, studentInsights,
  ] = await Promise.allSettled([
    distributionId ? getCloudFrontStats(distributionId) : Promise.resolve(null),
    getS3StorageStats(),
    redisService.getCounter(`ss:stats:s3uploads:monthly:${period}`),
    redisService.getCounter(`ss:stats:api:monthly:${period}`),
    redisService.getCounter(`ss:stats:api:daily:${today()}`),
    Video.countDocuments(),
    User.countDocuments(),
    Comment ? Comment.countDocuments() : Promise.resolve(0),
    getSegmentedComparison(),
    getOracleInsights(),
    getStudentInsights(),
  ]);

  const cf         = cfStats.status            === 'fulfilled' ? cfStats.value            : null;
  const s3         = s3Stats.status            === 'fulfilled' ? s3Stats.value            : null;
  const uploads    = s3UploadsMonth.status     === 'fulfilled' ? s3UploadsMonth.value     : 0;
  const apiMo      = apiMonth.status           === 'fulfilled' ? apiMonth.value           : 0;
  const apiDay     = apiToday.status           === 'fulfilled' ? apiToday.value           : 0;
  const videos     = videoCount.status         === 'fulfilled' ? videoCount.value         : 0;
  const users      = userCount.status          === 'fulfilled' ? userCount.value          : 0;
  const comments   = commentCount.status       === 'fulfilled' ? commentCount.value       : 0;
  const comparison = comparisonResult.status   === 'fulfilled' ? comparisonResult.value   : null;
  const oracle     = oracleInsights.status     === 'fulfilled' ? oracleInsights.value     : null;
  const student    = studentInsights.status    === 'fulfilled' ? studentInsights.value    : null;

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
    comparison,
    oracle,
    student,
    errors: {
      cloudfront:  cfStats.status          === 'rejected' ? String(cfStats.reason)                         : null,
      s3:          s3Stats.status          === 'rejected' ? String(s3Stats.reason)                         : null,
      comparison:  comparisonResult.status === 'rejected' ? String((comparisonResult as any).reason)       : null,
      oracle:      oracleInsights.status   === 'rejected' ? String((oracleInsights as any).reason)         : null,
      student:     studentInsights.status  === 'rejected' ? String((studentInsights as any).reason)        : null,
    },
  });
}
