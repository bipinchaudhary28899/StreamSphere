// services/saveVideo.service.ts
import { Video } from '../models/video';
import { CategoryDetectionService } from './categoryDetection.service';
import { redisService, CK } from './redis.service';

const categoryDetectionService = new CategoryDetectionService();

export const saveVideoService = async (title: string, description: string, S3_url: string, user_id: string, userName?: string, user_profile_image?: string) => {
  try {
    // Auto-detect category based on title and description
    const category = await categoryDetectionService.detectCategory(title, description);

    // Video is created with status='processing'. The HLS Lambda will transcode
    // 360p/720p/1080p renditions and call POST /api/internal/hls-complete to
    // flip status to 'ready' and set hlsUrl once transcoding is done.
    const newVideo = new Video({
      title,
      description,
      S3_url,
      hlsUrl: null,
      status: 'processing',
      user_id,
      userName,
      user_profile_image: user_profile_image || null,
      uploadedAt: new Date(),
      category,
    });

    const savedVideo = await newVideo.save();

    // ── Bust feed caches ──────────────────────────────────────────────────────
    // A new video exists so the "first page" and category pages are stale.
    await Promise.all([
      redisService.delPattern('ss:feed:all:*'),
      redisService.delPattern(`ss:feed:cat:${encodeURIComponent(category)}:*`),
      redisService.del(CK.topLiked()),
    ]);

    return savedVideo;
  } catch (error: any) {
    console.error('Error saving video:', error.stack);  // Log the full error stack
    throw error; // Re-throw the original error to preserve the message
  }
};
