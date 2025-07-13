import mongoose, { Schema, Document } from 'mongoose';

export interface IComment extends Document {
  video_id: string;
  user_id: string;
  username: string;
  user_profile_image?: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

const commentSchema = new Schema<IComment>({
  video_id: {
    type: String,
    required: true,
    ref: 'Video'
  },
  user_id: {
    type: String,
    required: true,
    ref: 'User'
  },
  username: {
    type: String,
    required: true
  },
  user_profile_image: {
    type: String,
    default: null
  },
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Index for better query performance
commentSchema.index({ video_id: 1, created_at: -1 });
commentSchema.index({ user_id: 1 });

export const Comment = mongoose.model<IComment>('Comment', commentSchema); 