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
}