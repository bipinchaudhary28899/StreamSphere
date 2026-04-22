import { Request, Response } from 'express';
import { WatchHistoryService } from '../services/watchHistory.service';

const watchHistoryService = new WatchHistoryService();
export class WatchHistoryController {
  async upsertWatchHistory(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;
      const userId = (req as any).user?.userId;

      if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      await watchHistoryService.upsertWatchHistory(userId, videoId);
      res.json({ message: 'Watch history updated' });
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to update watch history', error: error.message });
    }
  }

  async getWatchHistory(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;

      if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const history = await watchHistoryService.getWatchHistory(userId);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: 'Failed to fetch watch history', error: error.message });
    }
  }
}