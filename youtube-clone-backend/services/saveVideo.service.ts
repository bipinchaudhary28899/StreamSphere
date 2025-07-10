// services/saveVideo.service.ts
import { Video } from '../models/video';

export const saveVideoService = async (title: string, description: string, S3_url: string,user_id:string) => {
  try {
    console.log('Saving video with data:', { title, description, S3_url ,user_id});  // Log the incoming data

    const newVideo = new Video({
      title,
      description,
      S3_url,
      user_id,
      uploadedAt: new Date(),
    });

    const savedVideo = await newVideo.save();
    console.log('Video saved:', savedVideo);  // Log the saved video result

    return savedVideo;
  } catch (error:any) {
    console.error('Error saving video:', error.stack);  // Log the full error stack
    throw new Error('Failed to save video');
  }
};
