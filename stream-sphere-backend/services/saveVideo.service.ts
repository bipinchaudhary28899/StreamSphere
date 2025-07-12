// services/saveVideo.service.ts
import { Video } from '../models/video';
import { CategoryDetectionService } from './categoryDetection.service';
import { spawn } from 'child_process';
// @ts-ignore
import ffprobe from 'ffprobe-static';

const categoryDetectionService = new CategoryDetectionService();

// Function to get video duration using ffprobe
const getVideoDuration = (videoUrl: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    const ffprobePath = ffprobe.path;
    const args = [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoUrl
    ];

    const process = spawn(ffprobePath, args);
    let output = '';
    let error = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      error += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        resolve(duration);
      } else {
        reject(new Error(`FFprobe failed: ${error}`));
      }
    });
  });
};

export const saveVideoService = async (title: string, description: string, S3_url: string, user_id: string, user_name?: string) => {
  try {
    console.log('Saving video with data:', { title, description, S3_url, user_id, user_name });  // Log the incoming data

    // Check video duration (2 minutes = 120 seconds)
    try {
      const duration = await getVideoDuration(S3_url);
      console.log('Video duration:', duration, 'seconds');
      
      if (duration > 120) {
        throw new Error('Video duration exceeds 2 minutes (120 seconds). Please upload a shorter video.');
      }
    } catch (durationError) {
      console.error('Error checking video duration:', durationError);
      // If we can't check duration, we'll still allow the upload but log the issue
      console.warn('Could not verify video duration, proceeding with upload');
    }

    // Auto-detect category based on title and description
    const category = await categoryDetectionService.detectCategory(title, description);
    console.log('Detected category:', category);

    const newVideo = new Video({
      title,
      description,
      S3_url,
      user_id,
      user_name,
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
    throw error; // Re-throw the original error to preserve the message
  }
};
