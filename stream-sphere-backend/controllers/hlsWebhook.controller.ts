import { Request, Response } from 'express';
import { Video } from '../models/video';
import { redisService, CK } from '../services/redis.service';

export async function hlsWebhookController(req: Request, res: Response): Promise<void> {
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

  const cloudfrontBase   = process.env.CLOUDFRONT_URL!.replace(/\/$/, '');
  const rawCloudfrontUrl = `${cloudfrontBase}/${rawS3Key}`;

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
      },
    },
    { new: true },
  );

  if (!video) {
    res.status(404).json({ message: `No video found for S3_url: ${rawCloudfrontUrl}` });
    return;
  }

  await Promise.all([
    redisService.delPattern('ss:feed:all:*'),
    redisService.delPattern(`ss:feed:cat:${encodeURIComponent(video.category)}:*`),
    redisService.del(CK.singleVideo(String(video._id))),
    redisService.del(CK.topLiked()),
  ]);

  res.json({ ok: true, videoId: video._id, category: video.category });
}
