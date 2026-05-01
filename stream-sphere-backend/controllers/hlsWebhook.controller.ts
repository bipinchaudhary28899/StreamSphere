import { Request, Response } from 'express';
import { Video } from '../models/video';
import { redisService, CK } from '../services/redis.service';

export async function hlsWebhookController(req: Request, res: Response): Promise<void> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const secret = req.headers['x-hls-secret'];
  if (!secret || secret !== process.env.HLS_WEBHOOK_SECRET) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const { rawS3Key, masterHlsUrl, previewUrl, thumbnailUrl, category, aiSummary, timingMs } = req.body as {
    rawS3Key?:     string;
    masterHlsUrl?: string;
    previewUrl?:   string;
    thumbnailUrl?: string;
    category?:     string;
    aiSummary?:    string;
    timingMs?:     { ai?: number; p360?: number; p720?: number; p1080?: number };
  };

  if (!rawS3Key || !masterHlsUrl) {
    res.status(400).json({ message: 'rawS3Key and masterHlsUrl are required' });
    return;
  }

  const cloudfrontBase   = process.env.CLOUDFRONT_URL!.replace(/\/$/, '');
  const rawCloudfrontUrl = `${cloudfrontBase}/${rawS3Key}`;

  try {
    // ── Idempotency — if already processed, return 200 immediately ───────────
    // This prevents Lambda retries from re-doing 7+ minutes of transcoding.
    const existing = await Video.findOne({ S3_url: rawCloudfrontUrl }).lean();
    if (existing && (existing as any).status === 'ready') {
      res.json({ ok: true, videoId: (existing as any)._id, category: (existing as any).category, idempotent: true });
      return;
    }

    // ── Update video record (time the DB call itself) ────────────────────────
    const dbStart = Date.now();
    const video = await Video.findOneAndUpdate(
      { S3_url: rawCloudfrontUrl },
      {
        $set: {
          hlsUrl:       masterHlsUrl,
          previewUrl:   previewUrl   ?? null,
          thumbnailUrl: thumbnailUrl ?? null,
          category:     category     ?? 'General',
          aiSummary:    aiSummary    ?? null,
          status:       'ready',
          // Merge Lambda timings (DB timing added after await below)
          ...(timingMs || {}) && {
            'uploadTiming.aiMs':    timingMs?.ai,
            'uploadTiming.p360Ms':  timingMs?.p360,
            'uploadTiming.p720Ms':  timingMs?.p720,
            'uploadTiming.p1080Ms': timingMs?.p1080,
          },
        },
      },
      { new: true },
    );
    const dbUpdateMs = Date.now() - dbStart;

    // Patch dbUpdateMs in a second update so it reflects the actual elapsed time
    if (video) {
      await Video.updateOne(
        { _id: video._id },
        { $set: { 'uploadTiming.dbUpdateMs': dbUpdateMs } },
      );
    }

    if (!video) {
      // 404 here is expected if metadata hasn't been saved yet.
      // Return 404 — Lambda will NOT retry on 4xx (only on 5xx / timeout).
      res.status(404).json({ message: `No video found for S3_url: ${rawCloudfrontUrl}` });
      return;
    }

    // ── Cache invalidation (non-fatal) ───────────────────────────────────────
    await Promise.allSettled([
      redisService.delPattern('ss:feed:all:*'),
      redisService.delPattern(`ss:feed:cat:${encodeURIComponent(video.category)}:*`),
      redisService.del(CK.singleVideo(String(video._id))),
      redisService.del(CK.topLiked()),
    ]);

    res.json({ ok: true, videoId: video._id, category: video.category });

  } catch (err) {
    console.error('[hlsWebhook] Unexpected error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
}
