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
  
  console.log("backend email is : ", email);
  console.log("Google profile image URL: ", picture);
  
  let user = await User.findOne({ email });
  let isNewUser = false;
  
  if (!user) {
    // Create new user
    user = new User({
      name: name || 'Unknown User',
      email: email || '',
      profileImage: picture || '',
      isVerified: true,
      role: 'user'
    });
    await user.save();
    isNewUser = true;
    console.log("New user created with profile image: ", picture);
  } else {
    // Update existing user's profile image to get the latest from Google
    user.profileImage = picture || user.profileImage;
    user.name = name || user.name; // Also update name in case it changed
    await user.save();
    console.log("Updated existing user's profile image: ", picture);
  }

  console.log("backend user is : ", user);
  
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
      name: user.name, // Add name for consistency
      profileImage: user.profileImage || '', // Ensure it's always a string
      isVerified: user.isVerified,
      userId: user._id as string,
    },
    isNewUser
  };
};

// JWT authentication middleware
export function authenticateJWT(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  console.log('JWT Middleware - Auth header:', authHeader);
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('JWT Middleware - No token provided');
    return res.status(401).json({ message: 'No token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  console.log('JWT Middleware - Token received:', token.substring(0, 20) + '...');
  console.log('JWT Middleware - JWT_SECRET exists:', !!process.env.JWT_SECRET);
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    console.log('JWT Middleware - Token decoded successfully:', decoded);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT Middleware - Token verification failed:', err);
    return res.status(401).json({ message: 'Invalid token' });
  }
}
