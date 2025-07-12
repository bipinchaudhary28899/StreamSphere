// controllers/video.controller.ts
import { Request, Response } from 'express';
import { VideoService } from '../services/getVideo.service';

const videoService = new VideoService();

export class VideoController {
  /**
   * GET /api/videos
   * Fetch all videos
   */
  static async getVideos(req: Request, res: Response) {
    try {
      const videos = await videoService.getAllVideos();
      res.json(videos);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch videos', error });
    }
  }

  /**
   * GET /api/videos/:s3Url
   * Fetch a single video by S3 URL
   */
  static async getVideo(req: Request, res: Response) {
    try {
      const video = await videoService.getVideoByUrl(req.params.s3Url);
      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }
      res.json(video);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch video', error });
    }
  }

  /**
   * GET /api/videos/category/:category
   * Fetch videos by category
   */
  static async getVideosByCategory(req: Request, res: Response) {
    try {
      const { category } = req.params;
      const videos = await videoService.getVideosByCategory(category);
      res.json(videos);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch videos by category', error });
    }
  }

  static async likeVideo(req: Request, res: Response) {
    try {
      const { videoId } = req.params;
      // Use userId from JWT middleware
      const userId = (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
      }

      const updatedVideo = await videoService.likeVideo(videoId, userId);
      res.json(updatedVideo);
    } catch (error) {
      res.status(500).json({ message: 'Failed to like video', error });
    }
  }

  static async dislikeVideo(req: Request, res: Response) {
    try {
      const { videoId } = req.params;
      // Use userId from JWT middleware
      const userId = (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
      }

      const updatedVideo = await videoService.dislikeVideo(videoId, userId);
      res.json(updatedVideo);
    } catch (error) {
      res.status(500).json({ message: 'Failed to dislike video', error });
    }
  }

  static async getUserReaction(req: Request, res: Response) {
    try {
      const { videoId } = req.params;
      // Use userId from JWT middleware
      const userId = (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
      }

      const reaction = await videoService.getUserReaction(videoId, userId);
      res.json({ reaction });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get user reaction', error });
    }
  }

  /**
   * GET /api/videos/liked
   * Get videos liked by the authenticated user
   */
  static async getLikedVideos(req: Request, res: Response) {
    try {
      // Use userId from JWT middleware
      const userId = (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
      }

      const videos = await videoService.getLikedVideos(userId);
      res.json(videos);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch liked videos', error });
    }
  }

  /**
   * GET /api/videos/disliked
   * Get videos disliked by the authenticated user
   */
  static async getDislikedVideos(req: Request, res: Response) {
    try {
      // Use userId from JWT middleware
      const userId = (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({ message: 'User not authenticated' });
      }

      const videos = await videoService.getDislikedVideos(userId);
      res.json(videos);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch disliked videos', error });
    }
  }

  /**
   * GET /api/videos/top-liked
   * Get top 3 most liked videos for carousel
   */
  static async getTopLikedVideos(req: Request, res: Response) {
    try {
      const videos = await videoService.getTopLikedVideos();
      res.json(videos);
    } catch (error) {
      res.status(500).json({ message: 'Failed to get top liked videos', error });
    }
  }

  /**
   * DELETE /api/videos/:videoId
   * Delete a video (only by the uploader)
   */
  static async deleteVideo(req: Request, res: Response) {
    try {
      const { videoId } = req.params;
      const { userId } = req.body; // Get userId from request body
      
      if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
      }

      await videoService.deleteVideo(videoId, userId);
      res.json({ message: 'Video deleted successfully' });
    } catch (error: any) {
      if (error.message === 'Video not found') {
        return res.status(404).json({ message: 'Video not found' });
      }
      if (error.message === 'Unauthorized: You can only delete your own videos') {
        return res.status(403).json({ message: 'Unauthorized: You can only delete your own videos' });
      }
      res.status(500).json({ message: 'Failed to delete video', error: error.message });
    }
  }
}