// controllers/video.controller.ts
import { Request, Response } from 'express';
import { saveVideoService } from '../services/saveVideo.service';  // Import the service

export const saveVideoController = async (req: Request, res: Response): Promise<void> => {
  const { title, description, S3_url, user_id, user_name } = req.body;
    console.log('req.body at backend is :',req.body);
  try {
    const newVideo = await saveVideoService(title, description, S3_url, user_id, user_name);  // Call the service to save video

    res.status(201).json({
      message: 'Video saved successfully',
      video: newVideo,
    });
  } catch (error: any) {
    console.error(error);
    
    // Check if it's a duration error
    if (error.message && error.message.includes('duration exceeds')) {
      res.status(400).json({
        error: error.message,
      });
    } else {
      res.status(500).json({
        error: 'Failed to save video',
      });
    }
  }
};
