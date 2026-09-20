// services/auth.service.ts
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { User, IUser } from '../models/user';
import { toProfile } from './profile.service';
import { IUserResponse } from '../interfaces/userResponse.interface';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const handleGoogleLogin = async (token: string): Promise<IUserResponse> => {
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID
  });

  const payload = ticket.getPayload()!;
  const { name, email, picture } = payload;

  let user = await User.findOne({ email });
  let isNewUser = false;

  if (!user) {
    user = new User({
      name: name || 'Unknown User',
      email: email || '',
      profileImage: picture || '',
      googlePicture: picture || '',
      avatarSource: 'google',
      isVerified: true,
      role: 'user'
    });
    await user.save();
    isNewUser = true;
  } else {
    // Keep the Google photo and name current, but only show the Google photo
    // while the user hasn't chosen their own avatar.
    if (picture) user.googlePicture = picture;
    if ((user.avatarSource ?? 'google') === 'google') {
      user.profileImage = picture || user.profileImage;
    }
    user.name = name || user.name;
    await user.save();
  }

  return {
    token: signUserToken(user),
    user: {
      ...toProfile(user),
      role: user.role,
      userName: user.name,
      isVerified: user.isVerified,
    },
    isNewUser
  };
};

/** Signs the session token. It carries profileImage, which new comments use. */
export function signUserToken(user: IUser): string {
  const jwtPayload = {
    userId: user._id,
    email: user.email,
    name: user.name,
    profileImage: user.profileImage,
    subject: user._id
  };
  return jwt.sign(jwtPayload, process.env.JWT_SECRET!);
}

// JWT authentication middleware
export function authenticateJWT(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}
