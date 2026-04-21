// controllers/getVideo.controller.ts
import { Request, Response } from 'express';
import { VideoService } from '../services/getVideo.service';

const videoService = new VideoService();

export class VideoController {

  // ── Feed (cursor-based pagination + Redis cache) ──────────────────────────────
  /**
   * GET /api/feed?cursor=<id>&limit=<n>&category=<cat>
   *
   * cursor   — last _id seen by the client (omit for first page)
   * limit    — page size (default 12, max 40)
   * category — filter by category, 'All' or omit for global feed
   */
  static async getFeed(req: Request, res: Response) {
    try {
      const cursor   = req.query.cursor   as string | undefined;
      const category = req.query.category as string | undefined;
      // Only override the service's PAGE_SIZE default when the client
      // explicitly sends a ?limit= param (used for testing / power users).
      const rawLimit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const limit    = rawLimit ? Math.min(Math.max(rawLimit, 1), 40) : undefined;

      const page = await videoService.getPaginatedFeed(cursor, category, limit);
      res.json(page);
    } catch (error: any) {
      if (error.message === 'Invalid cursor') {
        return res.status(400).json({ message: 'Invalid cursor value' });
      }
      res.status(500).json({ message: 'Failed to fetch feed', error: error.message });
    }
  }

  /**
   * GET /api/feed/search?q=<term>
   * Server-side search with Redis caching (60 s TTL).
   */
  static async searchFeed(req: Request, res: Response) {
    try {
      const term     = (req.query.q        as string || '').trim();
      const category = (req.query.category as string || '').trim() || undefined;

      if (!term || term.length < 2) {
        return res.status(400).json({ message: 'Search term must be at least 2 characters' });
      }
      if (term.length > 100) {
        return res.status(400).json({ message: 'Search term too long' });
      }
      const videos = await videoService.searchVideos(term, category);
      res.json({ videos });
    } catch (error: any) {
      res.status(500).json({ message: 'Search failed', error: error.message });
    }
  }

  // ── Top-liked (hero carousel) ─────────────────────────────────────────────────
  static async getTopLikedVideos(req: Request, res: Response) {
    try {
      const videos = await videoService.getTopLikedVideos();
      res.json(videos);
    } catch (error) {
      res.status(500).json({ message: 'Failed to get top liked videos', error });
    }
  }

  // ── Single video ──────────────────────────────────────────────────────────────
  static async getVideoById(req: Request, res: Response) {
    try {
      const video = await videoService.getVideoById(req.params.videoId);
      if (!video) return res.status(404).json({ message: 'Video not found' });
      res.json(video);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch video', error });
    }
  }

  // ── Reactions ─────────────────────────────────────────────────────────────────
  static async likeVideo(req: Request, res: Response) {
    try {
      const { videoId } = req.params;
      const userId = (req as any).user?.userId;
      if (!userId) return res.status(401).json({ message: 'User not authenticated' });

      const updatedVideo = await videoService.likeVideo(videoId, userId);
      res.json(updatedVideo);
    } catch (error) {
      res.status(500).json({ message: 'Failed to like video', error });
    }
  }

  static async dislikeVideo(req: Request, res: Response) {
    try {
      const { videoId } = req.params;
      const userId = (req as any).user?.userId;
      if (!userId) return res.status(401).json({ message: 'User not authenticated' });

      const updatedVideo = await videoService.dislikeVideo(videoId, userId);
      res.json(updatedVideo);
    } catch (error) {
      res.status(500).json({ message: 'Failed to dislike video', error });
    }
  }

  static async getUserReaction(req: Request, res: Response) {
    try {
      const { videoId } = req.params;
      const userId = (req as any).user?.userId;
      if (!userId) return res.status(401).json({ message: 'User not authenticated' });

      const reaction = await videoService.getUserReaction(videoId, userId);
      res.json({ reaction });
    } catch (error) {
      res.status(500).json({ message: 'Failed to get user reaction', error });
    }
  }

  // ── User lists ────────────────────────────────────────────────────────────────
  static async getLikedVideos(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return res.status(401).json({ message: 'User not authenticated' });
      const videos = await videoService.getLikedVideos(userId);
      res.json(videos);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch liked videos', error });
    }
  }

  static async getDislikedVideos(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return res.status(401).json({ message: 'User not authenticated' });
      const videos = await videoService.getDislikedVideos(userId);
      res.json(videos);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch disliked videos', error });
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────
  static async deleteVideo(req: Request, res: Response) {
    try {
      const { videoId } = req.params;
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ message: 'User ID is required' });

      await videoService.deleteVideo(videoId, userId);
      res.json({ message: 'Video deleted successfully' });
    } catch (error: any) {
      if (error.message === 'Video not found')
        return res.status(404).json({ message: 'Video not found' });
      if (error.message.startsWith('Unauthorized'))
        return res.status(403).json({ message: error.message });
      res.status(500).json({ message: 'Failed to delete video', error: error.message });
    }
  }
}
