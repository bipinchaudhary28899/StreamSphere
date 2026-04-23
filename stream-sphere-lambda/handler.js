/**
 * stream-sphere-hls-lambda / handler.js
 *
 * Triggered by: S3 ObjectCreated event on prefix Videos/raw/
 *
 * Flow:
 *  1. Parse the S3 key from the event.
 *  2. Download the raw video to /tmp.
 *  3. Run FFmpeg to produce three HLS renditions:
 *       360p  — 640×360  @ 800 kbps
 *       720p  — 1280×720 @ 2800 kbps
 *       1080p — 1920×1080 @ 5000 kbps
 *  4. Build a master.m3u8 playlist.
 *  5. Upload every .m3u8 and .ts file to Videos/hls/<uuid>/ on S3.
 *  6. Call POST <BACKEND_URL>/api/internal/hls-complete with the master URL.
 *
 * Environment variables (set in Lambda configuration):
 *   AWS_S3_BUCKET_NAME    — same bucket as the backend
 *   CLOUDFRONT_URL        — CloudFront distribution base URL (no trailing slash)
 *   BACKEND_URL           — public URL of the Express backend
 *   HLS_WEBHOOK_SECRET    — shared secret for the webhook endpoint
 *
 * Deploy:
 *   npm ci --omit=dev
 *   zip -r function.zip handler.js node_modules
 *   aws lambda update-function-code --function-name StreamSphereHLS \
 *       --zip-file fileb://function.zip
 *
 * Lambda settings:
 *   Runtime      : Node.js 20.x
 *   Architecture : x86_64  (ffmpeg-static ships a Linux x64 binary)
 *   Memory       : 2048 MB (FFmpeg transcoding is CPU/RAM intensive)
 *   Timeout      : 10 min  (3-min videos take ~2-4 min to transcode)
 *   Ephemeral storage: 2048 MB (/tmp for raw + transcoded files)
 */

'use strict';

const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Copy the FFmpeg binary from the read-only layer (/opt/bin/ffmpeg) to /tmp
// so we can chmod +x it. /tmp is the only writable directory on Lambda.
const layerBinary = '/opt/bin/ffmpeg';
const tmpBinary   = '/tmp/ffmpeg';

if (fs.existsSync(layerBinary) && !fs.existsSync(tmpBinary)) {
  fs.copyFileSync(layerBinary, tmpBinary);
  execSync(`chmod +x ${tmpBinary}`);
  console.log('[HLS] Copied ffmpeg from layer to /tmp and set +x');
}

const ffmpegPath = fs.existsSync(tmpBinary) ? tmpBinary : require('ffmpeg-static');
console.log(`[HLS] Using ffmpeg at: ${ffmpegPath}`);
ffmpeg.setFfmpegPath(ffmpegPath);

const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });
const BUCKET = process.env.AWS_S3_BUCKET_NAME;
const CLOUDFRONT_URL = (process.env.CLOUDFRONT_URL || '').replace(/\/$/, '');
const BACKEND_URL = (process.env.BACKEND_URL || '').replace(/\/$/, '');
const HLS_WEBHOOK_SECRET = process.env.HLS_WEBHOOK_SECRET;

// ── Rendition definitions ─────────────────────────────────────────────────────
const RENDITIONS = [
  { name: '360p', width: 640,  height: 360, videoBitrate: '800k',  audioBitrate: '96k'  },
  { name: '720p', width: 1280, height: 720, videoBitrate: '2800k', audioBitrate: '128k' },
];

// ── Helper: stream S3 object to a local file ──────────────────────────────────
async function downloadFromS3(bucket, key, localPath) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(localPath);
    Readable.from(res.Body).pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
}

// ── Helper: upload a local file to S3 with public MIME type ──────────────────
async function uploadToS3(localPath, bucket, key, contentType) {
  const body = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

// ── Helper: transcode one rendition ──────────────────────────────────────────
function transcodeRendition(inputPath, outputDir, rendition) {
  return new Promise((resolve, reject) => {
    const playlistPath = path.join(outputDir, `${rendition.name}.m3u8`);

    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size(`${rendition.width}x${rendition.height}`)
      .videoBitrate(rendition.videoBitrate)
      .audioBitrate(rendition.audioBitrate)
      .outputOptions([
        '-profile:v baseline',
        '-level 3.0',
        '-start_number 0',
        '-hls_time 6',
        '-hls_list_size 0',
        '-hls_playlist_type vod',
        `-hls_segment_filename ${path.join(outputDir, `${rendition.name}_%03d.ts`)}`,
        '-f hls',
      ])
      .output(playlistPath)
      .on('end', () => resolve(playlistPath))
      .on('error', (err) => reject(new Error(`FFmpeg ${rendition.name} failed: ${err.message}`)))
      .run();
  });
}

// ── Helper: generate thumbnail JPEG (single frame at 1 s) ────────────────────
// 854×480 with aspect-ratio letterboxing, JPEG quality 2 (high; scale 1–31).
function generateThumbnail(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(1)
      .videoFilter('scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2')
      .outputOptions(['-vframes 1', '-q:v 2'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`Thumbnail generation failed: ${err.message}`)))
      .run();
  });
}

// ── Helper: generate 8-second MP4 preview (for carousel / hover) ──────────────
// 854×480, scale preserves aspect ratio with letterbox if needed.
// faststart moves the moov atom to the front so the browser can play
// immediately without downloading the whole file.
function generatePreview(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(0)
      .setDuration(8)
      .videoCodec('libx264')
      .audioCodec('aac')
      .videoFilter('scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2')
      .videoBitrate('600k')
      .audioBitrate('64k')
      .outputOptions([
        '-profile:v baseline',
        '-level 3.0',
        '-movflags +faststart',
        '-pix_fmt yuv420p',
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`Preview generation failed: ${err.message}`)))
      .run();
  });
}

// ── Helper: build a master HLS playlist ──────────────────────────────────────
function buildMasterPlaylist(renditions) {
  const BANDWIDTH = { '360p': 896000, '720p': 2928000 };
  let m3u8 = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
  for (const r of renditions) {
    m3u8 += `#EXT-X-STREAM-INF:BANDWIDTH=${BANDWIDTH[r.name]},RESOLUTION=${r.width}x${r.height},NAME="${r.name}"\n`;
    m3u8 += `${r.name}.m3u8\n`;
  }
  return m3u8;
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const record = event.Records[0];
  const rawKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

  console.log(`[HLS] Processing: ${rawKey}`);

  // Extract uuid from Videos/raw/<uuid>/filename
  const match = rawKey.match(/^Videos\/raw\/([^/]+)\//);
  if (!match) throw new Error(`Unexpected key format: ${rawKey}`);
  const uuid = match[1];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hls-${uuid}-`));
  const rawLocalPath = path.join(tmpDir, 'source' + path.extname(rawKey));

  try {
    // 1. Download raw video
    console.log('[HLS] Downloading source video…');
    await downloadFromS3(BUCKET, rawKey, rawLocalPath);
    console.log('[HLS] Download complete.');

    // 2. Transcode each rendition
    for (const rendition of RENDITIONS) {
      console.log(`[HLS] Transcoding ${rendition.name}…`);
      await transcodeRendition(rawLocalPath, tmpDir, rendition);
      console.log(`[HLS] ${rendition.name} done.`);
    }

    // 3a. Generate thumbnail JPEG (shown on video cards before hover)
    console.log('[HLS] Generating thumbnail.jpg…');
    const thumbnailLocalPath = path.join(tmpDir, 'thumbnail.jpg');
    await generateThumbnail(rawLocalPath, thumbnailLocalPath);
    console.log('[HLS] thumbnail.jpg done.');

    // 3b. Generate 8-second preview MP4 (used by carousel and hover previews)
    console.log('[HLS] Generating preview.mp4…');
    const previewLocalPath = path.join(tmpDir, 'preview.mp4');
    await generatePreview(rawLocalPath, previewLocalPath);
    console.log('[HLS] preview.mp4 done.');

    // 4. Build and write master.m3u8
    const masterContent = buildMasterPlaylist(RENDITIONS);
    const masterPath = path.join(tmpDir, 'master.m3u8');
    fs.writeFileSync(masterPath, masterContent);

    // 5. Upload all HLS + preview files to S3
    const hlsPrefix = `Videos/hls/${uuid}/`;
    const files = fs.readdirSync(tmpDir).filter(f => f !== path.basename(rawLocalPath));

    console.log(`[HLS] Uploading ${files.length} files to ${hlsPrefix}…`);
    for (const file of files) {
      const localFile = path.join(tmpDir, file);
      const s3Key = hlsPrefix + file;
      const contentType = file.endsWith('.m3u8')   ? 'application/vnd.apple.mpegurl'
                        : file.endsWith('.ts')     ? 'video/mp2t'
                        : file.endsWith('.mp4')    ? 'video/mp4'
                        : 'application/octet-stream';
      await uploadToS3(localFile, BUCKET, s3Key, contentType);
    }
    console.log('[HLS] Upload complete.');

    // 6. Notify backend
    const masterHlsUrl  = `${CLOUDFRONT_URL}/${hlsPrefix}master.m3u8`;
    const previewUrl    = `${CLOUDFRONT_URL}/${hlsPrefix}preview.mp4`;
    const thumbnailUrl  = `${CLOUDFRONT_URL}/${hlsPrefix}thumbnail.jpg`;
    console.log(`[HLS] Calling webhook — masterHlsUrl: ${masterHlsUrl}`);
    console.log(`[HLS]                 — previewUrl:   ${previewUrl}`);
    console.log(`[HLS]                 — thumbnailUrl: ${thumbnailUrl}`);

    await axios.post(
      `${BACKEND_URL}/api/internal/hls-complete`,
      { rawS3Key: rawKey, masterHlsUrl, previewUrl, thumbnailUrl },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-hls-secret': HLS_WEBHOOK_SECRET,
        },
        timeout: 15000,
      },
    );

    console.log('[HLS] Webhook acknowledged. Done.');
    return { statusCode: 200, body: 'OK' };

  } finally {
    // Clean up /tmp to avoid filling Lambda ephemeral storage across warm starts
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};
