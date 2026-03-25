export interface User {
  userId: string;
  name: string;
  email: string;
  profileImage?: string;
  role: 'user' | 'admin';
  isVerified: boolean;
}


