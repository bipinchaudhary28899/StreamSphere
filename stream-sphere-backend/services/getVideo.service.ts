// services/video.service.ts
import { Video } from '../models/video';

export class VideoService {
  /**
   * Get all videos sorted by upload date (newest first)
   */
  async getAllVideos() {
    return await Video.find().sort({ uploadedAt: -1 }).exec();
  }

  /**
   * Get a single video by S3 URL
   */
  async getVideoByUrl(S3_url: string) {
    return await Video.findOne({ S3_url }).exec();
  }

  /**
   * Get videos by category
   */
  async getVideosByCategory(category: string) {
    if (category === 'All') {
      return await Video.find().sort({ uploadedAt: -1 }).exec();
    }
    return await Video.find({ category }).sort({ uploadedAt: -1 }).exec();
  }
}