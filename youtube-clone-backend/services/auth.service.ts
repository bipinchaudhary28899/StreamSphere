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

  const { name, email, picture } = ticket.getPayload()!;

  let user = await User.findOne({ email });
  let isNewUser = false;

  if (!user) {
    user = new User({
      name,
      email,
      profileImage: picture,
      isVerified: true,
      role: 'user'
    });
    await user.save();
    isNewUser = true;
  }

  const jwtPayload = { subject: user._id, email: user.email, userId: user._id };
  const jwtToken = jwt.sign(jwtPayload, process.env.JWT_SECRET!);

  return {
    token: jwtToken,
    role: user.role,
    email: user.email,
    name: user.name,
    isVerified: user.isVerified,
    userId: user._id as string,  // ✅ Fix here
    isNewUser
  };
  
};
