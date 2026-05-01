import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
} from "@aws-sdk/client-s3";
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

// ── Single-PUT signed URL (kept for small files / fallback) ──────────────────

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

// ── Multipart upload ─────────────────────────────────────────────────────────

/**
 * Step 1 – create the multipart upload session.
 * Returns the uploadId, the stable S3 key, and the CloudFront URL for later.
 */
export const createMultipartUpload = async (
  filename: string,
  filetype: string,
): Promise<{ uploadId: string; key: string; cloudFrontUrl: string }> => {
  const safeName = path.basename(filename).replace(/\s+/g, "_");
  const key = `Videos/raw/${randomUUID()}/${safeName}`;

  const res = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      ContentType: filetype,
    }),
  );

  const cloudFrontUrl = `${process.env.CLOUDFRONT_URL}/${key}`;
  return { uploadId: res.UploadId!, key, cloudFrontUrl };
};

/**
 * Step 2 – generate one pre-signed URL per part.
 * Part numbers must be 1-based and ≤ 10 000.
 */
export const generatePartUrls = async (
  key: string,
  uploadId: string,
  partCount: number,
): Promise<{ partNumber: number; url: string }[]> => {
  return Promise.all(
    Array.from({ length: partCount }, (_, i) => i + 1).map(async (partNumber) => {
      const url = await getSignedUrl(
        s3,
        new UploadPartCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: 3600 },
      );
      return { partNumber, url };
    }),
  );
};

/**
 * Step 3 – complete the upload.
 * We call ListParts so the client never needs to forward ETags,
 * which avoids requiring ExposeHeaders: ['ETag'] in the S3 CORS policy.
 */
export const completeMultipartUpload = async (
  key: string,
  uploadId: string,
): Promise<void> => {
  // Collect all parts (handles >1000 parts via pagination)
  const parts: { PartNumber: number; ETag: string }[] = [];
  let partNumberMarker: string | undefined;

  do {
    const res = await s3.send(
      new ListPartsCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        ...(partNumberMarker ? { PartNumberMarker: partNumberMarker } : {}),
      }),
    );

    for (const part of res.Parts ?? []) {
      parts.push({ PartNumber: part.PartNumber!, ETag: part.ETag! });
    }

    partNumberMarker = res.IsTruncated ? String(res.NextPartNumberMarker ?? '') : undefined;
  } while (partNumberMarker);

  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  );
};

/**
 * Abort – clean up an in-progress multipart upload on error.
 */
export const abortMultipartUpload = async (
  key: string,
  uploadId: string,
): Promise<void> => {
  await s3.send(
    new AbortMultipartUploadCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      UploadId: uploadId,
    }),
  );
};
  
  
