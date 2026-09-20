// models/User.ts

import mongoose, { Document, Schema, Model } from 'mongoose';

/** Where the avatar comes from. `initials` shows the name's initials, no image. */
export type AvatarSource = 'google' | 'upload' | 'preset' | 'initials';
/** Where the channel banner comes from. `default` is the theme gradient. */
export type BannerSource = 'default' | 'upload' | 'preset';

interface IUser extends Document {
  name: string;
  email: string;
  /** The avatar every surface shows ('' = initials). Kept in step with avatarSource. */
  profileImage?: string;
  /** Latest Google account photo, so the user can switch back to it */
  googlePicture?: string;
  avatarSource?: AvatarSource;
  /** S3 key of an uploaded avatar, deleted when it is replaced */
  avatarKey?: string;
  bannerSource?: BannerSource;
  /** Banner URL for uploaded and preset banners */
  bannerImage?: string;
  /** S3 key of an uploaded banner, deleted when it is replaced */
  bannerKey?: string;
  isVerified: boolean;
  role: string;
}

const userSchema: Schema<IUser> = new mongoose.Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  profileImage: { type: String },
  googlePicture: { type: String },
  // No defaults: accounts created before custom avatars have no source, and
  // they read as 'google' (see toProfile in services/profile.service.ts).
  avatarSource: { type: String, enum: ['google', 'upload', 'preset', 'initials'] },
  avatarKey: { type: String },
  bannerSource: { type: String, enum: ['default', 'upload', 'preset'] },
  bannerImage: { type: String },
  bannerKey: { type: String },
  isVerified: { type: Boolean, required: true },
  role: { type: String, default: 'user' },
});

const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);
export { User, IUser };
