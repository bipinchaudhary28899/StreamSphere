export interface User {
  userId: string;
  name: string;
  email: string;
  /** Avatar shown everywhere; empty means initials */
  profileImage?: string;
  avatarSource?: 'google' | 'upload' | 'preset' | 'initials';
  /** The Google account photo, offered as an avatar choice */
  googlePicture?: string;
  bannerSource?: 'default' | 'upload' | 'preset';
  /** Empty means the theme's default banner */
  bannerImage?: string;
  role: 'user' | 'admin';
  isVerified: boolean;
}
