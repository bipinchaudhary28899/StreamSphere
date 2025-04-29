import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from "dotenv";

dotenv.config();

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Updated: Accept filename and filetype as parameters
export const generateSignedUrl = async (filename: string, filetype: string): Promise<string> => {
    if (!process.env.AWS_S3_BUCKET_NAME) {
      throw new Error('Bucket name is missing in the environment variables');
    }
  
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `Videos/${Date.now()}-${filename}`,
      ContentType: filetype,
    });
  
    try {
      const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
      return url;
    } catch (error) {
      console.error('Error generating signed URL:', error);
      throw new Error('Error generating signed URL');
    }
  };
  
  
