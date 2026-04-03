import { Request, Response } from 'express';
import { generateSignedUrl } from '../services/upload.service';

// Controller function to handle the request for generating signed URL
export const uploadController = async (req: Request, res: Response): Promise<void> => {
  const { filename, filetype } = req.body;
  try {
    const { signedUrl, key } = await generateSignedUrl(filename, filetype);
    const cloudFrontUrl = `${process.env.CLOUDFRONT_URL}/${key}`;
    res.json({ signedUrl, cloudFrontUrl });  // send both to frontend
  } catch (error) {
    res.status(500).json({ error: 'Error generating signed URL' });
  }
};
