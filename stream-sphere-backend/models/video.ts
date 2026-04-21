// models/video.model.ts
import mongoose, { Schema, Document } from 'mongoose';

interface IVideo extends Document {
  title: string;
  description: string;
  S3_url: string;
  user_id: string;
  userName?: string;
  uploadedAt: Date;
  category: string;
  likes: number;
  dislikes: number;
  likedBy: string[];
  dislikedBy: string[];
  views: number;
}

const videoSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: false, default: '' },
    S3_url: { type: String, required: true },
    user_id: { type: String, required: true },
    userName: { type: String },
    uploadedAt: { type: Date, required: true },
    category: { type: String, default: 'Uncategorized' },
    likes: { type: Number, default: 0 },
    dislikes: { type: Number, default: 0 },
    likedBy: [{ type: String }],
    dislikedBy: [{ type: String }],
    views: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// NOTE: { _id: -1 } is intentionally omitted — MongoDB creates the _id index
// automatically and does not allow overwriting it.

// Category feed: category filter + cursor (supports the compound query
// { category, _id: { $lt: cursor } } sorted by _id desc)
videoSchema.index({ category: 1, _id: -1 });

// Top-liked carousel
videoSchema.index({ likes: -1 });

// Top views
videoSchema.index({ views: -1 });

// Full-text search on title + description
videoSchema.index({ title: 'text', description: 'text' });

const Video = mongoose.model<IVideo>('Video', videoSchema);

export { Video };
