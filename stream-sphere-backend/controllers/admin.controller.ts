import { Request, Response } from 'express';
import { getCloudFrontStats, getS3StorageStats, FREE_TIER } from '../services/cloudwatch.service';
import { redisService } from '../services/redis.service';
import { Video } from '../models/video';
import { User }  from '../models/user';
import { StreamingSession } from '../models/streamingSession';

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

// ── GenABR aggregation helpers ────────────────────────────────────────────────

interface GroupedSessionStats {
  count:              number;
  avgPhi:             number | null;
  avgVmaf:            number | null;
  avgSigmaVmaf:       number | null;
  avgTotalStallMs:    number | null;
  avgStallCount:      number | null;
  avgBufferSec:       number | null;
}

async function getGenabrStats(): Promise<{
  totalSessions:  number;
  withGenabr:     GroupedSessionStats;
  withoutGenabr:  GroupedSessionStats;
  recentSessions: any[];
}> {
  // Aggregate: group by genabr_active, compute per-group averages.
  // avgBufferSec comes from the pings sub-array — compute the mean of all
  // buffer_level_sec values across pings per session, then average those means.
  const [aggResult, recentSessions] = await Promise.all([
    StreamingSession.aggregate([
      {
        // stallCount derived at query time; avg_buffer_sec is pre-computed by
        // qoe.service.ts at session end — no $lookup into telemetry_pings needed.
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

  return {
    totalSessions:  total,
    withGenabr:     toGroup(withRow),
    withoutGenabr:  toGroup(withoutRow),
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

// ── Controller ────────────────────────────────────────────────────────────────

export async function adminStatsController(req: Request, res: Response): Promise<void> {
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  const period         = currentPeriod();

  const [
    cfStats, s3Stats, s3UploadsMonth, apiMonth, apiToday,
    videoCount, userCount, commentCount, genabrStats,
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
    errors: {
      cloudfront: cfStats.status === 'rejected' ? String(cfStats.reason) : null,
      s3:         s3Stats.status === 'rejected' ? String(s3Stats.reason) : null,
      genabr:     genabrStats.status === 'rejected' ? String((genabrStats as any).reason) : null,
    },
  });
}
