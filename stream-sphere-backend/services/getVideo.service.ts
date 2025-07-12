// services/video.service.ts
import { Video } from '../models/video';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

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
    try {
      return await Video.find({ category }).sort({ uploadedAt: -1 });
    } catch (error) {
      console.error('Error fetching videos by category:', error);
      throw error;
    }
  }

  async likeVideo(videoId: string, userId: string) {
    try {
      const video = await Video.findById(videoId);
      if (!video) {
        throw new Error('Video not found');
      }

      // Check if user already liked
      if (video.likedBy.includes(userId)) {
        // Unlike
        video.likedBy = video.likedBy.filter(id => id !== userId);
        video.likes = Math.max(0, video.likes - 1);
      } else {
        // Like
        video.likedBy.push(userId);
        video.likes += 1;
        
        // Remove from disliked if user had disliked
        if (video.dislikedBy.includes(userId)) {
          video.dislikedBy = video.dislikedBy.filter(id => id !== userId);
          video.dislikes = Math.max(0, video.dislikes - 1);
        }
      }

      await video.save();
      return video;
    } catch (error) {
      console.error('Error liking video:', error);
      throw error;
    }
  }

  async dislikeVideo(videoId: string, userId: string) {
    try {
      const video = await Video.findById(videoId);
      if (!video) {
        throw new Error('Video not found');
      }

      // Check if user already disliked
      if (video.dislikedBy.includes(userId)) {
        // Remove dislike
        video.dislikedBy = video.dislikedBy.filter(id => id !== userId);
        video.dislikes = Math.max(0, video.dislikes - 1);
      } else {
        // Dislike
        video.dislikedBy.push(userId);
        video.dislikes += 1;
        
        // Remove from liked if user had liked
        if (video.likedBy.includes(userId)) {
          video.likedBy = video.likedBy.filter(id => id !== userId);
          video.likes = Math.max(0, video.likes - 1);
        }
      }

      await video.save();
      return video;
    } catch (error) {
      console.error('Error disliking video:', error);
      throw error;
    }
  }

  async getUserReaction(videoId: string, userId: string) {
    try {
      const video = await Video.findById(videoId);
      if (!video) {
        return null;
      }

      if (video.likedBy.includes(userId)) {
        return 'liked';
      } else if (video.dislikedBy.includes(userId)) {
        return 'disliked';
      } else {
        return 'none';
      }
    } catch (error) {
      console.error('Error getting user reaction:', error);
      throw error;
    }
  }

  /**
   * Get videos liked by a specific user
   */
  async getLikedVideos(userId: string) {
    try {
      return await Video.find({ likedBy: userId }).sort({ uploadedAt: -1 });
    } catch (error) {
      console.error('Error fetching liked videos:', error);
      throw error;
    }
  }

  /**
   * Get videos disliked by a specific user
   */
  async getDislikedVideos(userId: string) {
    try {
      return await Video.find({ dislikedBy: userId }).sort({ uploadedAt: -1 });
    } catch (error) {
      console.error('Error fetching disliked videos:', error);
      throw error;
    }
  }

  /**
   * Get top 3 most liked videos for carousel
   */
  async getTopLikedVideos() {
    try {
      return await Video.find({})
        .sort({ likes: -1 })
        .limit(3);
    } catch (error) {
      console.error('Error fetching top liked videos:', error);
      throw error;
    }
  }

  /**
   * Delete a video by ID (only if user is the uploader)
   * Also deletes the video file from S3
   */
  async deleteVideo(videoId: string, userId: string) {
    const video = await Video.findById(videoId);
    if (!video) {
      throw new Error('Video not found');
    }
    if (video.user_id !== userId) {
      throw new Error('Unauthorized: You can only delete your own videos');
    }

    // Extract S3 key from S3_url
    const s3Url = video.S3_url;
    const s3Key = s3Url.split('.amazonaws.com/')[1];
    if (!s3Key) {
      throw new Error('Could not extract S3 key from S3_url');
    }

    // Delete from S3
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: s3Key,
    }));

    // Delete from DB
    return await Video.findByIdAndDelete(videoId);
  }
}