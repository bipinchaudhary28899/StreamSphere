import { Request, Response } from 'express';
import {
  generateSignedUrl,
  createMultipartUpload,
  generatePartUrls,
  completeMultipartUpload,
  abortMultipartUpload,
} from '../services/upload.service';
import { redisService } from '../services/redis.service';

// ── Single-PUT (kept for fallback / small files) ─────────────────────────────

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

// ── Multipart upload controllers ─────────────────────────────────────────────

/** POST /api/upload/multipart/start */
export const startMultipartController = async (req: Request, res: Response): Promise<void> => {
  const { filename, filetype } = req.body;
  try {
    const result = await createMultipartUpload(filename, filetype);

    const d      = new Date();
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    redisService.incr(`ss:stats:s3uploads:monthly:${period}`, 35 * 86_400).catch(() => {});

    res.json(result); // { uploadId, key, cloudFrontUrl }
  } catch (error) {
    res.status(500).json({ error: 'Failed to start multipart upload' });
  }
};

/** POST /api/upload/multipart/part-urls */
export const partUrlsController = async (req: Request, res: Response): Promise<void> => {
  const { key, uploadId, partCount } = req.body;
  try {
    const parts = await generatePartUrls(key, uploadId, partCount);
    res.json({ parts }); // [{ partNumber, url }]
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate part URLs' });
  }
};

/** POST /api/upload/multipart/complete */
export const completeMultipartController = async (req: Request, res: Response): Promise<void> => {
  const { key, uploadId } = req.body;
  try {
    await completeMultipartUpload(key, uploadId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete multipart upload' });
  }
};

/** POST /api/upload/multipart/abort */
export const abortMultipartController = async (req: Request, res: Response): Promise<void> => {
  const { key, uploadId } = req.body;
  try {
    await abortMultipartUpload(key, uploadId);
    res.json({ success: true });
  } catch (error) {
    // Best-effort; don't fail the client
    res.json({ success: false });
  }
};
