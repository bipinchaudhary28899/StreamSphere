import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import path from "path";
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

/**
 * Generate a collision-proof S3 presigned PUT URL.
 *
 * Key format: Videos/raw/<uuid>/<sanitised-original-name>
 *
 * Using a UUID prefix (v4, 122 bits of randomness) instead of Date.now()
 * makes it impossible for two simultaneous uploads — even with the same
 * filename — to collide on the same S3 key.
 *
 * The `raw/` sub-prefix is the trigger prefix for the HLS Lambda function.
 * Lambda is configured to fire on s3:ObjectCreated events under Videos/raw/.
 * Transcoded HLS files are written to Videos/hls/<uuid>/ by the Lambda.
 */
export const generateSignedUrl = async (
  filename: string,
  filetype: string,
): Promise<{ signedUrl: string; key: string }> => {
  // Strip directory traversal and whitespace from the original filename
  const safeName = path.basename(filename).replace(/\s+/g, "_");
  const key = `Videos/raw/${randomUUID()}/${safeName}`;

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    ContentType: filetype,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
  return { signedUrl, key };
};
  
  
