// services/saveVideo.service.ts
//
// Saves the initial video document with status='processing'.
// Category and aiSummary are NOT set here — the HLS Lambda pipeline runs
// Whisper + GPT-4o-mini + HuggingFace and sends them via the webhook
// (POST /api/internal/hls-complete) once transcoding + AI are complete.

import { Video } from '../models/video';
import { redisService, CK } from './redis.service';

export const saveVideoService = async (
  title: string,
  description: string,
  S3_url: string,
  user_id: string,
  userName?: string,
  user_profile_image?: string,
) => {
  try {
    const newVideo = new Video({
      title,
      description,
      S3_url,
      hlsUrl:            null,
      previewUrl:        null,
      thumbnailUrl:      null,
      status:            'processing',
      user_id,
      userName,
      user_profile_image: user_profile_image || null,
      uploadedAt:        new Date(),
      // category and aiSummary arrive later via the Lambda webhook
      category:          'Uncategorized',
      aiSummary:         null,
    });

    const savedVideo = await newVideo.save();

    // Bust feed caches so the processing card shows up immediately
    await Promise.all([
      redisService.delPattern('ss:feed:all:*'),
      redisService.del(CK.topLiked()),
    ]);

    return savedVideo;
  } catch (error: any) {
    console.error('Error saving video:', error.stack);
    throw error;
  }
};
