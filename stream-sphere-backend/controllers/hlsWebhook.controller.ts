// controllers/hlsWebhook.controller.ts
//
// Called by the HLS Lambda after it finishes transcoding a video.
// The Lambda sends:
//   POST /api/internal/hls-complete
//   x-hls-secret: <HLS_WEBHOOK_SECRET>
//   { "rawS3Key":    "Videos/raw/<uuid>/filename.mp4",
//     "masterHlsUrl": "https://cdn.example.com/Videos/hls/<uuid>/master.m3u8",
//     "previewUrl":   "https://cdn.example.com/Videos/hls/<uuid>/preview.mp4" }
//
// We verify the shared secret, find the Video by its S3_url, set hlsUrl,
// previewUrl, and flip status to 'ready', then bust the relevant Redis caches.

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

  const { rawS3Key, masterHlsUrl, previewUrl } = req.body as {
    rawS3Key?: string;
    masterHlsUrl?: string;
    previewUrl?: string;
  };

  if (!rawS3Key || !masterHlsUrl) {
    res.status(400).json({ message: 'rawS3Key and masterHlsUrl are required' });
    return;
  }

  // Reconstruct the CloudFront URL that was stored in the Video document
  const cloudfrontBase = process.env.CLOUDFRONT_URL!.replace(/\/$/, '');
  const rawCloudfrontUrl = `${cloudfrontBase}/${rawS3Key}`;

  const video = await Video.findOne({ S3_url: rawCloudfrontUrl });
  if (!video) {
    res.status(404).json({ message: `No video found for S3_url: ${rawCloudfrontUrl}` });
    return;
  }

  // ── Update the video document ─────────────────────────────────────────────
  video.hlsUrl    = masterHlsUrl;
  video.previewUrl = previewUrl ?? null;
  video.status    = 'ready';
  await video.save();

  // ── Bust Redis caches so the video appears in the feed immediately ─────────
  await Promise.all([
    redisService.delPattern('ss:feed:all:*'),
    redisService.delPattern(`ss:feed:cat:${encodeURIComponent(video.category)}:*`),
    redisService.del(CK.singleVideo(String(video._id))),
    redisService.del(CK.topLiked()),
  ]);

  res.json({ ok: true, videoId: video._id });
}
