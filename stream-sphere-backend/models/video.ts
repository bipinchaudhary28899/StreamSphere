// models/video.model.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IUploadTiming {
  fileSizeBytes?: number;   // raw file size sent by browser
  durationSec?:   number;   // video duration in seconds
  s3UploadMs?:    number;   // multipart upload → S3 (frontend measured)
  aiMs?:          number;   // AI worker (Lambda measured)
  p360Ms?:        number;   // 360p rendition worker
  p720Ms?:        number;   // 720p rendition worker
  p1080Ms?:       number;   // 1080p rendition worker
  dbUpdateMs?:    number;   // findOneAndUpdate in webhook
}

interface IVideo extends Document {
  title: string;
  description: string;
  S3_url: string;
  hlsUrl: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  status: 'processing' | 'ready';
  user_id: string;
  userName?: string;
  user_profile_image?: string;
  uploadedAt: Date;
  category: string;
  aiSummary: string | null;
  likes: number;
  dislikes: number;
  likedBy: string[];
  dislikedBy: string[];
  views: number;
  uploadTiming?: IUploadTiming;
}

const videoSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: false, default: '' },
    S3_url: { type: String, required: true },
    hlsUrl: { type: String, default: null },
    previewUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    status: { type: String, enum: ['processing', 'ready'], default: 'processing' },
    user_id: { type: String, required: true },
    userName: { type: String },
    user_profile_image: { type: String, default: null },
    uploadedAt: { type: Date, required: true },
    category:   { type: String, default: 'Uncategorized' },
    aiSummary:  { type: String, default: null },           // AI-generated summary from Lambda pipeline
    likes: { type: Number, default: 0 },
    dislikes: { type: Number, default: 0 },
    likedBy: [{ type: String }],
    dislikedBy: [{ type: String }],
    views: { type: Number, default: 0 },
    uploadTiming: {
      fileSizeBytes: { type: Number },
      durationSec:   { type: Number },
      s3UploadMs:    { type: Number },
      aiMs:          { type: Number },
      p360Ms:        { type: Number },
      p720Ms:        { type: Number },
      p1080Ms:       { type: Number },
      dbUpdateMs:    { type: Number },
    },
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
