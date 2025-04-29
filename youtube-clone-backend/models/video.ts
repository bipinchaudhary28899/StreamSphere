// models/video.model.ts
import mongoose, { Schema, Document } from 'mongoose';

interface IVideo extends Document {
  title: string;
  description: string;
  url: string;
  uploadedAt: Date;
}

const videoSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    url: { type: String, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

const Video = mongoose.model<IVideo>('Video', videoSchema);

export { Video };
