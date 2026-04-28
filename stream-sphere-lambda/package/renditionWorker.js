'use strict';

/**
 * renditionWorker.js — single HLS rendition transcoder
 *
 * Invoked by the orchestrator for each quality tier (360p / 720p / 1080p).
 * Each invocation runs in its own Lambda container with isolated /tmp storage,
 * so there is no shared state or race condition between concurrent workers.
 *
 * Lambda settings (configure in AWS console):
 *   Handler  : renditionWorker.handler
 *   Memory   : 2048 MB   (libx264 is CPU/RAM hungry)
 *   Timeout  : 12 min
 *   Layers   : ffmpeg binary layer (same as before)
 *
 * Event payload (sent by orchestrator):
 *   {
 *     bucket    : string   — S3 bucket name
 *     rawKey    : string   — S3 key of the raw source video
 *     uuid      : string   — video UUID (determines output S3 prefix)
 *     rendition : {
 *       name         : string   — '360p' | '720p' | '1080p'
 *       width        : number
 *       height       : number
 *       videoBitrate : string   — e.g. '2800k'
 *       audioBitrate : string   — e.g. '128k'
 *     }
 *   }
 *
 * Return value (received by orchestrator via Payload):
 *   { success: true, renditionName: '720p', segmentCount: 14 }
 */

const { downloadFromS3, uploadToS3, contentTypeFor, ffmpeg } = require('./shared');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

exports.handler = async (event) => {
  const { bucket, rawKey, uuid, rendition } = event;
  const tag = `[WORKER:${rendition.name}]`;

  console.log(`${tag} Starting — source: ${rawKey}`);
  console.log(`${tag} Rendition: ${rendition.width}x${rendition.height} @ ${rendition.videoBitrate} video / ${rendition.audioBitrate} audio`);

  // Each invocation gets its own unique /tmp sub-directory — completely isolated
  const tmpDir       = fs.mkdtempSync(path.join(os.tmpdir(), `rend-${uuid}-${rendition.name}-`));
  const rawLocalPath = path.join(tmpDir, 'source' + path.extname(rawKey));
  const hlsPrefix    = `Videos/hls/${uuid}/`;

  try {
    // ── Download source ─────────────────────────────────────────────────────
    console.log(`${tag} Downloading source from S3…`);
    await downloadFromS3(bucket, rawKey, rawLocalPath);
    console.log(`${tag} Download complete (${(fs.statSync(rawLocalPath).size / 1_048_576).toFixed(1)} MB).`);

    // ── Transcode to HLS ────────────────────────────────────────────────────
    console.log(`${tag} Transcoding…`);
    const playlistPath = path.join(tmpDir, `${rendition.name}.m3u8`);

    await new Promise((resolve, reject) => {
      ffmpeg(rawLocalPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .size(`${rendition.width}x${rendition.height}`)
        .videoBitrate(rendition.videoBitrate)
        .audioBitrate(rendition.audioBitrate)
        .outputOptions([
          '-profile:v baseline', '-level 3.0',
          '-start_number 0',
          '-hls_time 6',
          '-hls_list_size 0',
          '-hls_playlist_type vod',
          // Segment filename pattern — unique per rendition, no collision possible
          `-hls_segment_filename ${path.join(tmpDir, `${rendition.name}_%03d.ts`)}`,
          '-f hls',
        ])
        .output(playlistPath)
        .on('end',   () => resolve())
        .on('error', (err) => reject(new Error(`FFmpeg ${rendition.name} failed: ${err.message}`)))
        .run();
    });

    console.log(`${tag} Transcode complete.`);

    // ── Collect output files ─────────────────────────────────────────────────
    // Only the variant playlist (.m3u8) and segments (.ts) for this rendition.
    // Source video is explicitly excluded.
    const files = fs.readdirSync(tmpDir).filter(f => {
      if (fs.statSync(path.join(tmpDir, f)).isDirectory()) return false;
      if (f === path.basename(rawLocalPath))               return false; // skip source
      return true;
    });

    const segmentCount = files.filter(f => f.endsWith('.ts')).length;
    console.log(`${tag} Uploading ${files.length} files (${segmentCount} segments) to ${hlsPrefix}…`);

    // Upload all segments + variant playlist in parallel — each writes to a
    // unique S3 key so there is no race condition with other rendition workers.
    await Promise.all(
      files.map(f =>
        uploadToS3(path.join(tmpDir, f), bucket, hlsPrefix + f, contentTypeFor(f))
      )
    );

    console.log(`${tag} Upload complete. ✅`);
    return { success: true, renditionName: rendition.name, segmentCount };

  } finally {
    // Always clean up /tmp to avoid ephemeral storage bloat on warm containers
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};
