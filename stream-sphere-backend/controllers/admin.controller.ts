/**
 * admin.controller.ts
 *
 * GET /api/admin/stats
 * Only accessible to bkumar28899@gmail.com (checked before this handler runs).
 *
 * Returns a unified stats payload used by the dev dashboard:
 *   - CloudFront metrics  (CloudWatch)
 *   - S3 storage size     (ListObjectsV2)
 *   - S3 upload count     (Redis counter — incremented in upload.controller)
 *   - Backend API traffic (Redis counter — incremented by statsMiddleware)
 *   - App stats           (MongoDB counts)
 *   - AWS Free Tier limits
 */

import { Request, Response } from 'express';
import { getCloudFrontStats, getS3StorageStats, FREE_TIER } from '../services/cloudwatch.service';
import { redisService } from '../services/redis.service';
import { Video }    from '../models/video';
import { User }     from '../models/user';

// Lazy import to avoid circular deps
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

export async function adminStatsController(req: Request, res: Response): Promise<void> {
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  const period         = currentPeriod();

  const [
    cfStats,
    s3Stats,
    s3UploadsMonth,
    apiMonth,
    apiToday,
    videoCount,
    userCount,
    commentCount,
  ] = await Promise.allSettled([
    distributionId
      ? getCloudFrontStats(distributionId)
      : Promise.resolve(null),
    getS3StorageStats(),
    redisService.getCounter(`ss:stats:s3uploads:monthly:${period}`),
    redisService.getCounter(`ss:stats:api:monthly:${period}`),
    redisService.getCounter(`ss:stats:api:daily:${today()}`),
    Video.countDocuments(),
    User.countDocuments(),
    Comment ? Comment.countDocuments() : Promise.resolve(0),
  ]);

  const cf      = cfStats.status        === 'fulfilled' ? cfStats.value        : null;
  const s3      = s3Stats.status        === 'fulfilled' ? s3Stats.value        : null;
  const uploads = s3UploadsMonth.status === 'fulfilled' ? s3UploadsMonth.value : 0;
  const apiMo   = apiMonth.status       === 'fulfilled' ? apiMonth.value       : 0;
  const apiDay  = apiToday.status       === 'fulfilled' ? apiToday.value       : 0;
  const videos  = videoCount.status     === 'fulfilled' ? videoCount.value     : 0;
  const users   = userCount.status      === 'fulfilled' ? userCount.value      : 0;
  const comments = commentCount.status  === 'fulfilled' ? commentCount.value   : 0;

  res.json({
    period,
    generatedAt: new Date().toISOString(),
    cloudfront: {
      distributionConfigured: !!distributionId,
      requests:       cf?.requests     ?? null,
      dataTransferGB: cf?.dataTransferGB ?? null,
    },
    s3: {
      storageGB:   s3?.storageGB   ?? null,
      objectCount: s3?.objectCount ?? null,
      putRequests: uploads,
    },
    backend: {
      apiRequestsMonth: apiMo,
      apiRequestsToday: apiDay,
    },
    app: { videos, users, comments },
    limits: FREE_TIER,
    errors: {
      cloudfront: cfStats.status === 'rejected' ? String(cfStats.reason) : null,
      s3:         s3Stats.status === 'rejected' ? String(s3Stats.reason) : null,
    },
  });
}
