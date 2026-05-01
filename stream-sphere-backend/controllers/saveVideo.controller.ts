import { Request, Response } from 'express';
import { saveVideoService } from '../services/saveVideo.service';

export const saveVideoController = async (req: Request, res: Response): Promise<void> => {
  const { title, description, S3_url, user_id, userName, user_profile_image,
          fileSizeBytes, durationSec, s3UploadMs } = req.body;
  try {
    const uploadTiming = { fileSizeBytes, durationSec, s3UploadMs };
    const newVideo = await saveVideoService(title, description, S3_url, user_id, userName, user_profile_image, uploadTiming);
    res.status(201).json({ message: 'Video saved successfully', video: newVideo });
  } catch (error: any) {
    if (error.message && error.message.includes('duration exceeds')) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to save video' });
    }
  }
};
