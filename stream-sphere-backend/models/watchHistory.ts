import mongoose, { Schema, Document } from 'mongoose';

export interface IWatchHistory extends Document {
  user_id: string;
  video_id: string;
  watchedAt: Date;
}

const watchHistorySchema = new Schema({
  user_id:   { type: String, required: true },
  video_id:  { type: String, ref: 'Video', required: true },
  watchedAt: { type: Date, default: Date.now }
});

watchHistorySchema.index({ user_id: 1, video_id: 1 }, { unique: true });

export const WatchHistory = mongoose.model<IWatchHistory>('WatchHistory', watchHistorySchema);