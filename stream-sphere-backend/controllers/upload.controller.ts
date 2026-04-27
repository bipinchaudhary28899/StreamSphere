import { Request, Response } from 'express';
import { generateSignedUrl } from '../services/upload.service';
import { redisService } from '../services/redis.service';

export const uploadController = async (req: Request, res: Response): Promise<void> => {
  const { filename, filetype } = req.body;
  try {
    const { signedUrl, key } = await generateSignedUrl(filename, filetype);
    const cloudFrontUrl = `${process.env.CLOUDFRONT_URL}/${key}`;

    const d      = new Date();
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    redisService.incr(`ss:stats:s3uploads:monthly:${period}`, 35 * 86_400).catch(() => {});

    res.json({ signedUrl, cloudFrontUrl });
  } catch (error) {
    res.status(500).json({ error: 'Error generating signed URL' });
  }
};
