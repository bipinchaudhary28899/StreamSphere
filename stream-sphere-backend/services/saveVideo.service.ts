// services/saveVideo.service.ts
import { Video } from '../models/video';
import { CategoryDetectionService } from './categoryDetection.service';

const categoryDetectionService = new CategoryDetectionService();

export const saveVideoService = async (title: string, description: string, S3_url: string, user_id: string) => {
  try {
    console.log('Saving video with data:', { title, description, S3_url, user_id });  // Log the incoming data

    // Auto-detect category based on title and description
    const category = await categoryDetectionService.detectCategory(title, description);
    console.log('Detected category:', category);

    const newVideo = new Video({
      title,
      description,
      S3_url,
      user_id,
      uploadedAt: new Date(),
      category,
    });

    const savedVideo = await newVideo.save();
    console.log('Video saved:', savedVideo);  // Log the saved video result

    // Properly handle the _id property
    const videoId = savedVideo._id ? savedVideo._id.toString() : null;
    console.log('Video ID:', videoId);

    return savedVideo;
  } catch (error: any) {
    console.error('Error saving video:', error.stack);  // Log the full error stack
    throw new Error('Failed to save video');
  }
};
