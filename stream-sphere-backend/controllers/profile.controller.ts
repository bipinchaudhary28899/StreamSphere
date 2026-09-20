import { Request, Response } from 'express';
import {
  ProfileError,
  createImageUpload,
  getProfile,
  toProfile,
  updateProfile,
} from '../services/profile.service';
import { signUserToken } from '../services/auth.service';

interface AuthenticatedRequest extends Request {
  user?: { userId: string };
}

function sendError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof ProfileError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  console.error(`[profile] ${fallback}:`, (error as Error)?.message ?? error);
  res.status(500).json({ message: fallback });
}

/** GET /api/profile */
export async function getProfileController(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const user = await getProfile(req.user!.userId);
    res.json({ user: toProfile(user) });
  } catch (error) {
    sendError(res, error, 'Couldn’t load your profile');
  }
}

/** POST /api/profile/image-upload — signs the S3 PUT for a cropped image */
export async function createProfileImageUploadController(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { kind, contentType, size } = req.body;
    res.json(await createImageUpload(req.user!.userId, kind, contentType, size));
  } catch (error) {
    sendError(res, error, 'Couldn’t start the upload');
  }
}

/**
 * PATCH /api/profile
 * Returns a fresh token too: the old one still carries the previous avatar,
 * which new comments would otherwise keep using.
 */
export async function updateProfileController(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const user = await updateProfile(req.user!.userId, req.body);
    res.json({ user: toProfile(user), token: signUserToken(user) });
  } catch (error) {
    sendError(res, error, 'Couldn’t save your profile');
  }
}
