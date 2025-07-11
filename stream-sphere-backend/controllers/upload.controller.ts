import { Request, Response } from 'express';
import { generateSignedUrl } from '../services/upload.service';

// Controller function to handle the request for generating signed URL
export const uploadController = async (req: Request, res: Response): Promise<void> => {
  const { filename, filetype } = req.body;

  try {
    const signedUrl = await generateSignedUrl(filename, filetype);
    res.json({ signedUrl });
  } catch (error) {
    res.status(500).json({ error: 'Error generating signed URL' });
  }
};
