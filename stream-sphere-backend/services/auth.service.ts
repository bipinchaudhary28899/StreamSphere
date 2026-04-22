// services/auth.service.ts
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { User } from '../models/user';
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
      isVerified: true,
      role: 'user'
    });
    await user.save();
    isNewUser = true;
  } else {
    // Refresh profile image and name from Google on every login
    user.profileImage = picture || user.profileImage;
    user.name = name || user.name;
    await user.save();
  }

  const jwtPayload = {
    userId: user._id,
    email: user.email,
    name: user.name,
    profileImage: user.profileImage,
    subject: user._id
  };
  const jwtToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!);

  return {
    token: jwtToken,
    user: {
      role: user.role,
      email: user.email,
      userName: user.name,
      name: user.name,
      profileImage: user.profileImage || '',
      isVerified: user.isVerified,
      userId: user._id as string,
    },
    isNewUser
  };
};

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
