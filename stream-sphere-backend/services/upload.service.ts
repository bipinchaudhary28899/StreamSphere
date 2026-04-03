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
  requestChecksumCalculation: "WHEN_REQUIRED",  
  responseChecksumValidation: "WHEN_REQUIRED",  
});

// Updated: Accept filename and filetype as parameters
export const generateSignedUrl = async (filename: string, filetype: string): Promise<{ signedUrl: string, key: string }> => {
  const key = `Videos/${Date.now()}-${filename}`;
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    ContentType: filetype,
  });
  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
  return { signedUrl, key };  // return key too
};
  
  
