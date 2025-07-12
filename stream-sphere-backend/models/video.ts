// models/video.model.ts
import mongoose, { Schema, Document } from 'mongoose';

interface IVideo extends Document {
  title: string;
  description: string;
  S3_url: string;
  user_id: string;
  user_name?: string;
  uploadedAt: Date;
  category: string;
  likes: number;
  dislikes: number;
  likedBy: string[];
  dislikedBy: string[];
}

const videoSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: false, default: '' },
    S3_url: { type: String, required: true },
    user_id: { type: String, required: true },
    user_name: { type: String },
    uploadedAt: { type: Date, required: true },
    category: { type: String, default: 'Uncategorized' },
    likes: { type: Number, default: 0 },
    dislikes: { type: Number, default: 0 },
    likedBy: [{ type: String }],
    dislikedBy: [{ type: String }],
  },
  { timestamps: true }
);

const Video = mongoose.model<IVideo>('Video', videoSchema);

export { Video };
