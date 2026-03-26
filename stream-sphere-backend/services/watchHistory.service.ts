import { WatchHistory } from '../models/watchHistory';

export class WatchHistoryService {
  async upsertWatchHistory(userId: string, videoId: string) {
    await WatchHistory.findOneAndUpdate(
      { user_id: userId, video_id: videoId },
      { watchedAt: new Date() },
      { upsert: true, new: true }
    );
  }

  async getWatchHistory(userId: string) {
    return await WatchHistory.find({ user_id: userId })
      .sort({ watchedAt: -1 })
      .populate('video_id')
      .limit(50);
  }
}