// controllers/hlsWebhook.controller.ts
//
// Called by the HLS Lambda after it finishes transcoding + AI pipeline.
// The Lambda sends:
//   POST /api/internal/hls-complete
//   x-hls-secret: <HLS_WEBHOOK_SECRET>
//   { "rawS3Key":     "Videos/raw/<uuid>/filename.mp4",
//     "masterHlsUrl": "https://cdn.example.com/Videos/hls/<uuid>/master.m3u8",
//     "previewUrl":   "https://cdn.example.com/Videos/hls/<uuid>/preview.mp4",
//     "thumbnailUrl": "https://cdn.example.com/Videos/hls/<uuid>/thumbnail.jpg",
//     "category":     "Music",
//     "aiSummary":    "This is a music video by..." }
//
// We verify the shared secret, find the Video by its S3_url, and write all
// fields in one $set (bypasses Mongoose change-tracking), then bust caches.
// category and aiSummary are produced entirely inside Lambda — the Node.js
// backend no longer calls HuggingFace or any AI service directly.

import { Request, Response } from 'express';
import { Video } from '../models/video';
import { redisService, CK } from '../services/redis.service';

export async function hlsWebhookController(req: Request, res: Response): Promise<void> {
  // ── Authenticate via shared secret ───────────────────────────────────────
  const secret = req.headers['x-hls-secret'];
  if (!secret || secret !== process.env.HLS_WEBHOOK_SECRET) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const { rawS3Key, masterHlsUrl, previewUrl, thumbnailUrl, category, aiSummary } = req.body as {
    rawS3Key?:     string;
    masterHlsUrl?: string;
    previewUrl?:   string;
    thumbnailUrl?: string;
    category?:     string;
    aiSummary?:    string;
  };

  if (!rawS3Key || !masterHlsUrl) {
    res.status(400).json({ message: 'rawS3Key and masterHlsUrl are required' });
    return;
  }

  // Reconstruct the CloudFront URL that was stored in the Video document at upload time
  const cloudfrontBase   = process.env.CLOUDFRONT_URL!.replace(/\/$/, '');
  const rawCloudfrontUrl = `${cloudfrontBase}/${rawS3Key}`;

  // ── Update via $set — bypasses Mongoose change-tracking so all fields
  //    are always written to MongoDB regardless of their previous value. ──────
  const video = await Video.findOneAndUpdate(
    { S3_url: rawCloudfrontUrl },
    {
      $set: {
        hlsUrl:       masterHlsUrl,
        previewUrl:   previewUrl   ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
        category:     category     ?? 'General',   // set by Lambda AI pipeline
        aiSummary:    aiSummary    ?? null,         // set by Lambda AI pipeline
        status:       'ready',
      },
    },
    { new: true },  // return the updated document
  );

  if (!video) {
    res.status(404).json({ message: `No video found for S3_url: ${rawCloudfrontUrl}` });
    return;
  }

  // ── Bust Redis caches so the video appears in the feed immediately ─────────
  await Promise.all([
    redisService.delPattern('ss:feed:all:*'),
    redisService.delPattern(`ss:feed:cat:${encodeURIComponent(video.category)}:*`),
    redisService.del(CK.singleVideo(String(video._id))),
    redisService.del(CK.topLiked()),
  ]);

  res.json({ ok: true, videoId: video._id, category: video.category });
}
