// models/User.ts

import mongoose, { Document, Schema, Model } from 'mongoose';

interface IUser extends Document {
  name: string;
  email: string;
  profileImage?: string;
  isVerified: boolean;
  role: string;
}

const userSchema: Schema<IUser> = new mongoose.Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  profileImage: { type: String },
  isVerified: { type: Boolean, required: true },
  role: { type: String, default: 'user' },
});

const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);
export { User, IUser };
