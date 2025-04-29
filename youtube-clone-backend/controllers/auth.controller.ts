// controllers/auth.controller.ts
import { Request, Response } from 'express';
import { handleGoogleLogin } from '../services/auth.service';

export const googleLogin = async (req: Request, res: Response): Promise<void> => {
  const { token } = req.body;

  try {
    const loginResponse = await handleGoogleLogin(token);
    res.status(200).send(loginResponse);
  } catch (error) {
    console.error('🔴 Google Login Error:', error);
    res.status(500).send({ msg: 'Something went wrong' });
  }
};
