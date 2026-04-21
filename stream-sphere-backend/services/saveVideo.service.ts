// services/saveVideo.service.ts
import { Video } from '../models/video';
import { CategoryDetectionService } from './categoryDetection.service';
import { redisService, CK } from './redis.service';
import { spawn } from 'child_process';
// @ts-ignore
import ffprobe from 'ffprobe-static';

const categoryDetectionService = new CategoryDetectionService();

// ── ffprobe concurrency limiter ───────────────────────────────────────────────
// Each ffprobe call streams the video from CloudFront and forks a subprocess.
// Without a cap, 20 simultaneous uploads would spawn 20 child processes all
// hammering the network at once. We allow at most MAX_CONCURRENT at a time;
// extras queue and wait for a slot to free up.
const MAX_CONCURRENT_FFPROBE = 4;
let activeProbes = 0;
const probeQueue: Array<() => void> = [];

function acquireProbeSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeProbes < MAX_CONCURRENT_FFPROBE) {
      activeProbes++;
      resolve();
    } else {
      probeQueue.push(() => { activeProbes++; resolve(); });
    }
  });
}

function releaseProbeSlot(): void {
  const next = probeQueue.shift();
  if (next) {
    next();
  } else {
    activeProbes--;
  }
}

// Function to get video duration using ffprobe (with concurrency guard)
const getVideoDuration = async (videoUrl: string): Promise<number> => {
  await acquireProbeSlot();
  return new Promise((resolve, reject) => {
    const ffprobePath = ffprobe.path;
    const args = [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoUrl,
    ];

    const proc = spawn(ffprobePath, args);
    let output = '';
    let error = '';

    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { error += data.toString(); });

    proc.on('close', (code) => {
      releaseProbeSlot();
      if (code === 0) {
        resolve(parseFloat(output.trim()));
      } else {
        reject(new Error(`FFprobe failed: ${error}`));
      }
    });

    proc.on('error', (err) => {
      releaseProbeSlot();
      reject(err);
    });
  });
};

export const saveVideoService = async (title: string, description: string, S3_url: string, user_id: string, userName?: string) => {
  try {
    console.log('Saving video with data:', { title, description, S3_url, user_id, userName });  // Log the incoming data

    // Check video duration (2 minutes = 120 seconds)
    try {
      const duration = await getVideoDuration(S3_url);
      console.log('Video duration:', duration, 'seconds');
      
      if (duration > 180) {
        throw new Error('Video duration exceeds 3 minutes (180 seconds). Please upload a shorter video.');
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
      userName,
      uploadedAt: new Date(),
      category,
    });

    const savedVideo = await newVideo.save();
    console.log('Video saved:', savedVideo);

    const videoId = savedVideo._id ? savedVideo._id.toString() : null;
    console.log('Video ID:', videoId);

    // ── Bust feed caches ──────────────────────────────────────────────────────
    // A new video exists so the "first page" and category pages are stale.
    await Promise.all([
      redisService.delPattern('ss:feed:all:*'),
      redisService.delPattern(`ss:feed:cat:${encodeURIComponent(category)}:*`),
      redisService.del(CK.topLiked()),
    ]);

    return savedVideo;
  } catch (error: any) {
    console.error('Error saving video:', error.stack);  // Log the full error stack
    throw error; // Re-throw the original error to preserve the message
  }
};
