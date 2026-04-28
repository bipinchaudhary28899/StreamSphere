'use strict';

/**
 * orchestrator.js — parallel fan-out coordinator
 *
 * Replaces handler.js as the S3-triggered entry point.
 *
 * What it does:
 *   1. Receives the S3 ObjectCreated event (Videos/raw/ prefix)
 *   2. Fans out to 4 workers in parallel via Lambda SDK (InvocationType: RequestResponse):
 *        • stream-sphere-rendition-worker  ← 360p   (each in its own Lambda container)
 *        • stream-sphere-rendition-worker  ← 720p
 *        • stream-sphere-rendition-worker  ← 1080p  (new)
 *        • stream-sphere-ai-worker         ← AI + thumbnail + preview
 *   3. Waits for all workers with Promise.allSettled (renditions) / Promise.all (AI)
 *   4. Builds master.m3u8 from whichever renditions succeeded
 *   5. Uploads master.m3u8 to S3
 *   6. Calls the backend webhook exactly once
 *
 * Race-condition analysis:
 *   • Each rendition worker writes to unique S3 keys  (360p_*.ts, 720p_*.ts, 1080p_*.ts)
 *   • The AI worker writes to thumbnail.jpg and preview.mp4 — neither rendition worker
 *     touches these keys.
 *   • master.m3u8 is written ONLY by this orchestrator, AFTER all workers have resolved.
 *   • The backend webhook is called ONCE by this function at the very end.
 *   → No shared mutable state between concurrent workers. Zero race conditions.
 *
 * Lambda settings (configure in AWS console):
 *   Handler      : orchestrator.handler
 *   Memory       : 512 MB   (lightweight — coordination only, no FFmpeg)
 *   Timeout      : 13 min   (must exceed the slowest worker timeout)
 *   Trigger      : S3 ObjectCreated on Videos/raw/ prefix  (same as before)
 *   Layers       : none required (no FFmpeg)
 *
 * Required environment variables (in addition to the existing ones):
 *   RENDITION_WORKER_FUNCTION_NAME  — ARN or name of the rendition worker Lambda
 *   AI_WORKER_FUNCTION_NAME         — ARN or name of the AI worker Lambda
 *
 * IAM: the orchestrator's execution role needs:
 *   lambda:InvokeFunction on the two worker function ARNs
 */

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { S3Client, PutObjectCommand }  = require('@aws-sdk/client-s3');
const axios = require('axios');

// ── Config ────────────────────────────────────────────────────────────────────
const BUCKET             = process.env.AWS_S3_BUCKET_NAME;
const CLOUDFRONT_URL     = (process.env.CLOUDFRONT_URL    || '').replace(/\/$/, '');
const BACKEND_URL        = (process.env.BACKEND_URL       || '').replace(/\/$/, '');
const HLS_WEBHOOK_SECRET = process.env.HLS_WEBHOOK_SECRET;

// Worker function names — set these as env vars in the Lambda console
// so you don't have to redeploy to point at a renamed function.
const RENDITION_WORKER_FN = process.env.RENDITION_WORKER_FUNCTION_NAME;
const AI_WORKER_FN        = process.env.AI_WORKER_FUNCTION_NAME;

// ── Rendition definitions ─────────────────────────────────────────────────────
// Single source of truth — determines both which workers are invoked AND
// which streams appear in the master playlist.
// 1080p is new; 360p and 720p are unchanged from the original handler.
const RENDITIONS = [
  { name: '360p',  width: 640,  height: 360,  videoBitrate: '800k',  audioBitrate: '96k',  bandwidth: 896000  },
  { name: '720p',  width: 1280, height: 720,  videoBitrate: '2800k', audioBitrate: '128k', bandwidth: 2928000 },
  { name: '1080p', width: 1920, height: 1080, videoBitrate: '5000k', audioBitrate: '192k', bandwidth: 5192000 },
];

// ── AWS clients ───────────────────────────────────────────────────────────────
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const s3Client     = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });

// ── Invoke a worker and return its parsed result ──────────────────────────────
// Uses synchronous invocation (RequestResponse) — orchestrator blocks until
// the worker's handler returns or throws.
async function invokeWorker(functionName, payload) {
  const cmd = new InvokeCommand({
    FunctionName:   functionName,
    InvocationType: 'RequestResponse',
    Payload:        Buffer.from(JSON.stringify(payload)),
  });

  const response  = await lambdaClient.send(cmd);
  const resultStr = Buffer.from(response.Payload).toString('utf-8');
  const result    = JSON.parse(resultStr);

  // Lambda sets FunctionError when the handler threw an unhandled exception.
  // The Payload contains { errorMessage, errorType, stackTrace }.
  if (response.FunctionError) {
    throw new Error(
      `Worker "${functionName}" failed (${response.FunctionError}): ${result.errorMessage ?? 'unknown error'}`
    );
  }

  return result;
}

// ── Build the HLS master playlist from whichever renditions succeeded ─────────
function buildMasterPlaylist(successfulRenditions) {
  let m3u8 = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
  for (const r of successfulRenditions) {
    m3u8 += `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.width}x${r.height},NAME="${r.name}"\n`;
    m3u8 += `${r.name}.m3u8\n`;
  }
  return m3u8;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  // ── Parse S3 trigger ─────────────────────────────────────────────────────────
  const record = event.Records[0];
  const rawKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  console.log(`[ORCH] Processing: ${rawKey}`);

  const match = rawKey.match(/^Videos\/raw\/([^/]+)\//);
  if (!match) throw new Error(`[ORCH] Unexpected S3 key format: ${rawKey}`);
  const uuid      = match[1];
  const hlsPrefix = `Videos/hls/${uuid}/`;

  // ── Validate env vars early — fail fast before invoking workers ───────────
  if (!RENDITION_WORKER_FN) throw new Error('[ORCH] RENDITION_WORKER_FUNCTION_NAME env var is not set');
  if (!AI_WORKER_FN)        throw new Error('[ORCH] AI_WORKER_FUNCTION_NAME env var is not set');

  // ── Fan-out: all 4 workers start simultaneously ───────────────────────────
  // Promise.allSettled for renditions: one rendition failing (e.g. OOM on 1080p)
  // must not abort 360p and 720p which may have completed successfully.
  //
  // AI worker is wrapped in a .catch() for the same reason — a Whisper timeout
  // must not prevent the video from being published with whatever renditions we have.

  console.log(`[ORCH] Invoking ${RENDITIONS.length} rendition workers + 1 AI worker in parallel…`);

  const [renditionResults, aiResult] = await Promise.all([

    Promise.allSettled(
      RENDITIONS.map(rendition =>
        invokeWorker(RENDITION_WORKER_FN, { bucket: BUCKET, rawKey, uuid, rendition })
          .then(r => {
            console.log(`[ORCH] ✅ ${rendition.name} done (${r.segmentCount} segments)`);
            return r;
          })
          .catch(err => {
            console.error(`[ORCH] ❌ ${rendition.name} FAILED:`, err.message);
            throw err; // re-throw so allSettled records status: 'rejected'
          })
      )
    ),

    invokeWorker(AI_WORKER_FN, { bucket: BUCKET, rawKey, uuid })
      .then(r => {
        console.log(`[ORCH] ✅ AI done — category="${r.category}"`);
        return r;
      })
      .catch(err => {
        // AI failure is non-fatal — video still gets published with fallback metadata
        console.error('[ORCH] ❌ AI worker FAILED (non-fatal):', err.message);
        return { aiSummary: null, category: 'General' };
      }),

  ]);

  // ── Assess rendition results ──────────────────────────────────────────────
  const successfulRenditions = RENDITIONS.filter((_, i) => renditionResults[i].status === 'fulfilled');
  const failedRenditions     = RENDITIONS.filter((_, i) => renditionResults[i].status === 'rejected');

  if (failedRenditions.length > 0) {
    console.warn(`[ORCH] Failed renditions: ${failedRenditions.map(r => r.name).join(', ')}`);
  }

  // At least one rendition must succeed — otherwise the video is unplayable
  if (successfulRenditions.length === 0) {
    throw new Error('[ORCH] All rendition workers failed — cannot publish video');
  }

  console.log(`[ORCH] Successful renditions: ${successfulRenditions.map(r => r.name).join(', ')}`);

  // ── Build + upload master.m3u8 ────────────────────────────────────────────
  // Only lists streams that actually exist in S3.
  // Written by the orchestrator only, after all workers are done → no race.
  const masterContent = buildMasterPlaylist(successfulRenditions);

  await s3Client.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         `${hlsPrefix}master.m3u8`,
    Body:        masterContent,
    ContentType: 'application/vnd.apple.mpegurl',
  }));

  console.log(`[ORCH] Uploaded master.m3u8 (${successfulRenditions.length} rendition(s))`);

  // ── Call backend webhook — exactly once ───────────────────────────────────
  const masterHlsUrl = `${CLOUDFRONT_URL}/${hlsPrefix}master.m3u8`;
  const previewUrl   = `${CLOUDFRONT_URL}/${hlsPrefix}preview.mp4`;
  const thumbnailUrl = `${CLOUDFRONT_URL}/${hlsPrefix}thumbnail.jpg`;
  const { aiSummary, category } = aiResult;

  console.log(`[ORCH] Calling backend webhook — category="${category}"…`);
  await axios.post(
    `${BACKEND_URL}/api/internal/hls-complete`,
    { rawS3Key: rawKey, masterHlsUrl, previewUrl, thumbnailUrl, category, aiSummary },
    {
      headers: { 'Content-Type': 'application/json', 'x-hls-secret': HLS_WEBHOOK_SECRET },
      timeout: 15000,
    },
  );

  console.log('[ORCH] Done ✓');
  return { statusCode: 200, body: 'OK' };
};
