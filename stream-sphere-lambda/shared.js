'use strict';

/**
 * shared.js — common utilities for all Lambda workers
 *
 * Imported by: orchestrator.js, renditionWorker.js, aiWorker.js
 *
 * FFmpeg setup runs at module-load time (outside any handler), so the binary
 * copy from the Lambda layer happens once on cold start and is then cached for
 * every subsequent warm invocation of the same container.
 */

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');
const ffmpeg       = require('fluent-ffmpeg');
const fs           = require('fs');
const { execSync } = require('child_process');

// ── FFmpeg binary setup ───────────────────────────────────────────────────────
// /opt/bin/ffmpeg  → provided by the attached Lambda layer (read-only)
// /tmp/ffmpeg      → writable copy we can chmod +x
// Each Lambda container (worker) has its own isolated /tmp, so workers never
// race on this path.

const layerFfmpeg = '/opt/bin/ffmpeg';
const tmpFfmpeg   = '/tmp/ffmpeg';

if (fs.existsSync(layerFfmpeg) && !fs.existsSync(tmpFfmpeg)) {
  fs.copyFileSync(layerFfmpeg, tmpFfmpeg);
  execSync(`chmod +x ${tmpFfmpeg}`);
  console.log('[INIT] Copied ffmpeg from layer → /tmp');
}
if (!fs.existsSync(tmpFfmpeg)) {
  throw new Error('ffmpeg binary not found — ensure the Lambda layer is attached to this function');
}
ffmpeg.setFfmpegPath(tmpFfmpeg);
console.log(`[INIT] ffmpeg ready: ${tmpFfmpeg}`);

// ── S3 client ─────────────────────────────────────────────────────────────────
const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });

// ── S3 helpers ────────────────────────────────────────────────────────────────

/**
 * Stream-download an S3 object to a local file path.
 */
async function downloadFromS3(bucket, key, localPath) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(localPath);
    Readable.from(res.Body).pipe(ws);
    ws.on('finish', resolve);
    ws.on('error',  reject);
  });
}

/**
 * Upload a local file to S3 with the given content-type.
 */
async function uploadToS3(localPath, bucket, key, contentType) {
  const body = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

/**
 * Return the correct HTTP content-type header for common media file extensions.
 */
function contentTypeFor(filename) {
  if (filename.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (filename.endsWith('.ts'))   return 'video/mp2t';
  if (filename.endsWith('.mp4'))  return 'video/mp4';
  if (filename.endsWith('.jpg'))  return 'image/jpeg';
  return 'application/octet-stream';
}

module.exports = { ffmpeg, tmpFfmpeg, s3, downloadFromS3, uploadToS3, contentTypeFor };
