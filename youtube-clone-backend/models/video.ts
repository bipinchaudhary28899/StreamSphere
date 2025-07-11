// models/video.model.ts
import mongoose, { Schema, Document } from 'mongoose';

interface IVideo extends Document {
  title: string;
  description: string;
  S3_url: string;
  user_id: string;
  uploadedAt: Date;
  category: string;
}

const videoSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    S3_url: { type: String, required: true },
    user_id: { type: String, required: true },
    uploadedAt: { type: Date, required: true },
    category: { type: String, default: 'Uncategorized' },
  },
  { timestamps: true }
);

const Video = mongoose.model<IVideo>('Video', videoSchema);

export { Video };
