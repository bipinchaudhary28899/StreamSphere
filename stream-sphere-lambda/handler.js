/**
 * stream-sphere-hls-lambda / handler.js
 *
 * Triggered by: S3 ObjectCreated event on prefix Videos/raw/
 *
 * Pipeline:
 *  Phase 1 — FFmpeg: HLS renditions, thumbnail, preview, audio extraction
 *  Phase 2 — Metadata: ffprobe audio check + fetch title/description from backend
 *  Phase 3 — Decision: deterministic if/else → which AI steps to run
 *  Phase 4 — Parallel AI:
 *              ├── Whisper API → transcript (if has_audio)
 *              └── GPT-4o-mini vision → visual summary (always)
 *  Phase 5 — Synthesis: GPT-4o-mini text → aiSummary (rich context)
 *  Phase 6 — Categorization: HuggingFace bart-large-mnli → category
 *  Phase 7 — Webhook: POST all results to backend
 *
 * Environment variables (set in Lambda configuration):
 *   AWS_S3_BUCKET_NAME    — same bucket as the backend
 *   CLOUDFRONT_URL        — CloudFront distribution base URL (no trailing slash)
 *   BACKEND_URL           — public URL of the Express backend
 *   HLS_WEBHOOK_SECRET    — shared secret for the webhook endpoint
 *   OPENAI_API_KEY        — for Whisper transcription + GPT-4o-mini
 *   HUGGING_FACE_API_KEY  — for bart-large-mnli zero-shot classification
 *
 * Lambda settings:
 *   Runtime      : Node.js 20.x  (native fetch + FormData + Blob — no extra deps)
 *   Architecture : x86_64
 *   Memory       : 2048 MB
 *   Timeout      : 12 min
 *   Ephemeral    : 2048 MB
 */

'use strict';

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { execSync, spawnSync } = require('child_process');

// ── FFmpeg binary setup ───────────────────────────────────────────────────────
// Copy binaries from the read-only Lambda layer (/opt/bin/) to /tmp so we can
// chmod +x them. /tmp is the only writable directory in Lambda.

// ── ffmpeg ────────────────────────────────────────────────────────────────────
// The Lambda layer provides /opt/bin/ffmpeg. Copy to /tmp so we can chmod +x.
// ffmpeg-static is devDependency only (local dev) — not bundled in the zip.
const layerFfmpeg = '/opt/bin/ffmpeg';
const tmpFfmpeg   = '/tmp/ffmpeg';
if (fs.existsSync(layerFfmpeg) && !fs.existsSync(tmpFfmpeg)) {
  fs.copyFileSync(layerFfmpeg, tmpFfmpeg);
  execSync(`chmod +x ${tmpFfmpeg}`);
  console.log('[INIT] Copied ffmpeg from layer to /tmp');
}
if (!fs.existsSync(tmpFfmpeg)) throw new Error('ffmpeg binary not found — ensure the Lambda layer is attached');
const ffmpegBin = tmpFfmpeg;
ffmpeg.setFfmpegPath(ffmpegBin);
console.log(`[INIT] ffmpeg: ${ffmpegBin}`);

// ── Config ────────────────────────────────────────────────────────────────────
const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });
const BUCKET             = process.env.AWS_S3_BUCKET_NAME;
const CLOUDFRONT_URL     = (process.env.CLOUDFRONT_URL    || '').replace(/\/$/, '');
const BACKEND_URL        = (process.env.BACKEND_URL       || '').replace(/\/$/, '');
const HLS_WEBHOOK_SECRET = process.env.HLS_WEBHOOK_SECRET;
const OPENAI_API_KEY     = process.env.OPENAI_API_KEY;
const HF_API_KEY         = process.env.HUGGING_FACE_API_KEY;

// ── HuggingFace categories ────────────────────────────────────────────────────
// Identical list to what the backend used — kept here so Node.js never needs HF.
// ORDER MATTERS: bart-large-mnli has a small positional bias toward earlier
// labels when scores are very close — so anchor the highest-priority genres first.
const CATEGORIES = [
  'Music',            // ← anchored first: music videos often also score on Motivation/Fitness
  'Gaming',           // ← anchored second: gaming content clear-cut
  'Sports',
  'Movies',
  'Comedy',
  'Web Series',
  'Learning',
  'Podcasts',
  'News',
  'Fitness',
  'Vlogs',
  'Travel',
  'Tech',
  'Food & Recipes',
  'Motivation',
  'Short Films',
  'Art & Design',
  'Fashion',
  'Kids',
  'History',
  'DIY',
  'Documentaries',
  'Spirituality',
  'Real Estate',
  'Automotive',
  'Science',
  'Nature',
  'Animals',
  'Health & Wellness',
  'Business & Finance',
  'Personal Development',
  'Unboxing & Reviews',
  'Live Streams',
  'Events & Conferences',
  'Memes & Challenges',
  'festivals',
  'Interviews',
  'Trailers & Teasers',
  'Animation',
  'Magic & Illusions',
  'Comedy Skits',
  'Parodies',
  'Reaction Videos',
  'ASMR',
];

// ── Rendition definitions ─────────────────────────────────────────────────────
const RENDITIONS = [
  { name: '360p', width: 640,  height: 360,  videoBitrate: '800k',  audioBitrate: '96k'  },
  { name: '720p', width: 1280, height: 720,  videoBitrate: '2800k', audioBitrate: '128k' },
];

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 1 — FFmpeg processing helpers
// ════════════════════════════════════════════════════════════════════════════════

async function downloadFromS3(bucket, key, localPath) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(localPath);
    Readable.from(res.Body).pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
  });
}

async function uploadToS3(localPath, bucket, key, contentType) {
  const body = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

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
        '-profile:v baseline', '-level 3.0',
        '-start_number 0', '-hls_time 6',
        '-hls_list_size 0', '-hls_playlist_type vod',
        `-hls_segment_filename ${path.join(outputDir, `${rendition.name}_%03d.ts`)}`,
        '-f hls',
      ])
      .output(playlistPath)
      .on('end', () => resolve(playlistPath))
      .on('error', (err) => reject(new Error(`FFmpeg ${rendition.name} failed: ${err.message}`)))
      .run();
  });
}

function generateThumbnail(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(1)
      .videoFilter('scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2')
      .outputOptions(['-vframes 1', '-q:v 2'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`Thumbnail failed: ${err.message}`)))
      .run();
  });
}

function generatePreview(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(0).setDuration(8)
      .videoCodec('libx264').audioCodec('aac')
      .videoFilter('scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2')
      .videoBitrate('600k').audioBitrate('64k')
      .outputOptions(['-profile:v baseline', '-level 3.0', '-movflags +faststart', '-pix_fmt yuv420p'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`Preview failed: ${err.message}`)))
      .run();
  });
}

// NEW: mono MP3 clip (first 90s) — input for Whisper
function extractAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-t',  '90',           // first 90 seconds — Whisper sweet spot
        '-vn',                 // drop video stream
        '-acodec', 'libmp3lame',
        '-q:a', '4',           // ~165 kbps
        '-ac', '1',            // mono — halves file size, Whisper doesn't need stereo
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', (err) => reject(new Error(`Audio extraction failed: ${err.message}`)))
      .run();
  });
}

function buildMasterPlaylist(renditions) {
  const BANDWIDTH = { '360p': 896000, '720p': 2928000 };
  let m3u8 = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
  for (const r of renditions) {
    m3u8 += `#EXT-X-STREAM-INF:BANDWIDTH=${BANDWIDTH[r.name]},RESOLUTION=${r.width}x${r.height},NAME="${r.name}"\n`;
    m3u8 += `${r.name}.m3u8\n`;
  }
  return m3u8;
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Metadata (no AI)
// ════════════════════════════════════════════════════════════════════════════════

// Detect audio stream using ffmpeg -i (no ffprobe needed).
// ffmpeg always writes stream info to stderr when given -i — we just parse it.
// Fails open (returns true) so we always attempt transcription on ambiguity.
function checkHasAudio(inputPath) {
  const result = spawnSync(ffmpegBin, ['-i', inputPath], { timeout: 10000 });
  // ffmpeg exits with code 1 when no output is specified — that's expected.
  // Stream info is always written to stderr regardless of exit code.
  const stderr = result.stderr?.toString() ?? '';
  const hasAudio = stderr.includes('Audio:');
  console.log(`[META] Audio stream detected: ${hasAudio}`);
  return hasAudio;
}

// Call the backend's internal endpoint to get the video's title + description.
// Lambda only receives the S3 key, not the user-supplied metadata.
async function fetchVideoMeta(rawS3Key) {
  try {
    const s3url = `${CLOUDFRONT_URL}/${rawS3Key}`;
    const res = await fetch(
      `${BACKEND_URL}/api/internal/video-meta?s3url=${encodeURIComponent(s3url)}`,
      { headers: { 'x-hls-secret': HLS_WEBHOOK_SECRET }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) { console.warn(`[META] video-meta ${res.status}`); return { title: '', description: '' }; }
    return await res.json(); // { title, description }
  } catch (err) {
    console.warn('[META] fetchVideoMeta error:', err.message);
    return { title: '', description: '' };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Deterministic decision layer (no LLM)
// ════════════════════════════════════════════════════════════════════════════════

function decideSteps(hasAudio) {
  // Always describe frames visually — even music videos and silent content benefit.
  // Only transcribe when an audio track is present (avoids wasting Whisper quota).
  const steps = ['visual_describe'];
  if (hasAudio) steps.push('transcribe');
  return steps;
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 4a — Whisper transcription
// ════════════════════════════════════════════════════════════════════════════════

async function transcribeAudio(audioPath) {
  if (!OPENAI_API_KEY) { console.warn('[AI] OPENAI_API_KEY not set — skipping Whisper'); return null; }
  if (!audioPath || !fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1000) {
    console.log('[AI] Audio file absent or too small — skipping Whisper');
    return null;
  }

  try {
    // Node.js 20 has native FormData + Blob — no form-data package needed
    const audioBuffer = fs.readFileSync(audioPath);
    const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
    const formData = new FormData();
    formData.append('file', blob, 'audio.mp3');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'text');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: formData,
      signal: AbortSignal.timeout(60000), // Whisper can take time for long clips
    });

    if (!res.ok) { console.warn(`[AI] Whisper HTTP ${res.status}`); return null; }

    const text = (await res.text()).trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    // Whisper on music-only / near-silent audio returns very short garbled text.
    // Treat fewer than 20 words as "no spoken content".
    if (wordCount < 20) {
      console.log(`[AI] Whisper returned only ${wordCount} words — treated as non-speech audio`);
      return null;
    }

    console.log(`[AI] Whisper: ${wordCount} words transcribed`);
    return text;
  } catch (err) {
    console.warn('[AI] Whisper error:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 4b — Scene-detected keyframes + GPT-4o-mini vision
// ════════════════════════════════════════════════════════════════════════════════

// Scene detection: FFmpeg scores every frame 0.0–1.0 based on how different it
// is from the previous. Threshold 0.3 catches genuine scene cuts without
// firing on every camera shake. Capped at 5 frames to control cost.
// Using spawnSync (not fluent-ffmpeg) for reliable filter argument passing
// and stderr capture to diagnose failures.
function extractSceneFrames(inputPath, framesDir) {
  fs.mkdirSync(framesDir, { recursive: true });

  const result = spawnSync(ffmpegBin, [
    '-i', inputPath,
    '-vf', 'select=gt(scene\\,0.3),scale=512:288', // \, escapes comma inside select expr
    '-vsync', 'vfr',
    '-q:v', '3',
    '-frames:v', '5',
    path.join(framesDir, 'scene_%03d.jpg'),
  ], { timeout: 30000 });

  if (result.status !== 0 && result.stderr) {
    // Log last 300 chars of stderr — ffmpeg is verbose, only tail matters
    console.warn('[AI] Scene detection stderr:', result.stderr.toString().slice(-300));
  }

  return fs.readdirSync(framesDir)
    .filter(f => f.startsWith('scene_'))
    .map(f => path.join(framesDir, f));
}

// Fallback: extract frames at fixed timestamps (1s, 10s, 30s).
// Works for any video length — shorter videos just skip the later timestamps.
function extractFallbackFrames(inputPath, framesDir) {
  const timestamps = [1, 10, 30];
  const frames = [];
  for (let i = 0; i < timestamps.length; i++) {
    const outputPath = path.join(framesDir, `fallback_${i}.jpg`);
    spawnSync(ffmpegBin, [
      '-ss', String(timestamps[i]),
      '-i', inputPath,
      '-vframes', '1',
      '-q:v', '3',
      '-vf', 'scale=512:288:force_original_aspect_ratio=decrease',
      outputPath,
    ], { timeout: 15000 });
    if (fs.existsSync(outputPath)) frames.push(outputPath);
  }
  return frames;
}

function extractKeyframes(inputPath, framesDir) {
  const sceneFrames = extractSceneFrames(inputPath, framesDir);
  if (sceneFrames.length > 0) {
    console.log(`[AI] Scene detection: ${sceneFrames.length} keyframes`);
    return sceneFrames;
  }
  console.log('[AI] Scene detection yielded 0 frames — using timestamp fallback');
  const fallbackFrames = extractFallbackFrames(inputPath, framesDir);
  console.log(`[AI] Fallback frames: ${fallbackFrames.length}`);
  return fallbackFrames;
}

async function describeFrames(framePaths) {
  if (!framePaths.length) { console.log('[AI] No frames — skipping vision'); return null; }
  if (!OPENAI_API_KEY)    { console.warn('[AI] OPENAI_API_KEY not set — skipping vision'); return null; }

  try {
    // detail:'low' = 85 tokens/image. 5 frames ≈ 425 tokens ≈ $0.00006.
    const imageContent = framePaths.slice(0, 5).map(fp => ({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${fs.readFileSync(fp).toString('base64')}`,
        detail: 'low',
      },
    }));

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'These are keyframes from a video. Describe: the type of content (tutorial, music video, gaming, vlog, etc.), the setting or environment, people or activity visible, and any text or branding on screen. 2–3 sentences, factual and specific.',
            },
            ...imageContent,
          ],
        }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) { console.warn(`[AI] GPT-4o-mini vision HTTP ${res.status}`); return null; }
    const data = await res.json();
    const result = data.choices?.[0]?.message?.content?.trim() ?? null;
    if (result) console.log(`[AI] Visual summary: ${result.slice(0, 100)}…`);
    return result;
  } catch (err) {
    console.warn('[AI] Vision error:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 5 — Synthesis (GPT-4o-mini text — separate concern from vision)
// ════════════════════════════════════════════════════════════════════════════════

async function synthesizeSummary({ title, description, transcript, visualSummary }) {
  // Build only the signals we actually have
  const signals = [
    title         ? `Video title: ${title}`                                              : null,
    description   ? `Uploader description: ${description}`                               : null,
    transcript    ? `Spoken content (transcript): ${transcript.slice(0, 800)}`           : null,
    visualSummary ? `Visual content (from keyframes): ${visualSummary}`                  : null,
  ].filter(Boolean).join('\n\n');

  // Fallback if no OpenAI key or no signals at all
  if (!OPENAI_API_KEY || !signals) {
    return [title, description, visualSummary].filter(Boolean).join('. ') || title || 'Video';
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 250,
        messages: [
          {
            role: 'system',
            content:
              'You write concise video summaries for content classification. ' +
              'Output a single paragraph (3–4 sentences) covering: what the video is about, ' +
              'its genre or format, key topics or themes, and intended audience. ' +
              'Be specific and factual. Do not speculate beyond what the signals tell you.',
          },
          { role: 'user', content: signals },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content?.trim();
    if (summary) { console.log(`[AI] aiSummary: ${summary.slice(0, 120)}…`); return summary; }
    return signals; // fallback to raw signals
  } catch (err) {
    console.warn('[AI] Synthesis error:', err.message);
    // Fallback: concatenate raw signals — still much richer than title alone
    return [title, description, visualSummary].filter(Boolean).join('. ') || title || 'Video';
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PHASE 6 — HuggingFace categorization (moved from Node.js backend)
// ════════════════════════════════════════════════════════════════════════════════

async function categorize(aiSummary) {
  if (!HF_API_KEY) { console.warn('[AI] HUGGING_FACE_API_KEY not set — defaulting to General'); return 'General'; }

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        'https://router.huggingface.co/hf-inference/models/facebook/bart-large-mnli',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${HF_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inputs: aiSummary,
            // "This video belongs to the X genre/category" gives bart-large-mnli
            // sharper separation between content-type labels (Music, Gaming, etc.)
            // vs topic labels (Motivation, History, etc.) because "genre/category"
            // is a stronger signal than the vague "is about".
            parameters: { candidate_labels: CATEGORIES, hypothesis_template: 'This video belongs to the {} genre or category.' },
          }),
          signal: AbortSignal.timeout(25000),
        },
      );

      if (res.ok) {
        const raw = await res.json();
        console.log('[AI] HuggingFace raw:', JSON.stringify(raw).slice(0, 300));

        // Handle all known HF response shapes:
        //   Shape A — object:  { sequence, labels: [...], scores: [...] }
        //   Shape B — array:   [{ sequence, labels: [...], scores: [...] }]
        //   Shape C — router:  { label: "Music", score: 0.9 }  (single best)
        const result = Array.isArray(raw) ? raw[0] : raw;

        let category = 'General';
        let score;

        if (result?.labels?.length) {
          // Shape A or B — full zero-shot response with ranked labels
          category = result.labels[0];
          score    = result.scores?.[0];
        } else if (result?.label) {
          // Shape C — single label response
          category = result.label;
          score    = result.score;
        }

        console.log(`[AI] HuggingFace category: ${category} (score: ${score?.toFixed?.(3) ?? score})`);
        return category;
      }

      if ([429, 503].includes(res.status) && attempt < MAX_RETRIES) {
        const delay = attempt * 1000;
        console.warn(`[AI] HuggingFace attempt ${attempt} failed (${res.status}) — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.warn(`[AI] HuggingFace non-retryable HTTP ${res.status}`);
        return 'General';
      }
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, attempt * 1000));
      } else {
        console.warn('[AI] HuggingFace error:', err.message);
        return 'General';
      }
    }
  }
  return 'General';
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  const record = event.Records[0];
  const rawKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  console.log(`[HLS] Processing: ${rawKey}`);

  const match = rawKey.match(/^Videos\/raw\/([^/]+)\//);
  if (!match) throw new Error(`Unexpected key format: ${rawKey}`);
  const uuid = match[1];

  const tmpDir       = fs.mkdtempSync(path.join(os.tmpdir(), `hls-${uuid}-`));
  const rawLocalPath = path.join(tmpDir, 'source' + path.extname(rawKey));
  const audioPath    = path.join(tmpDir, 'audio.mp3');
  const framesDir    = path.join(tmpDir, 'frames');

  try {
    // ── Phase 1: FFmpeg ───────────────────────────────────────────────────────
    console.log('[HLS] Downloading source video…');
    await downloadFromS3(BUCKET, rawKey, rawLocalPath);
    console.log('[HLS] Download complete.');

    // HLS transcoding (sequential — each rendition is RAM/CPU intensive)
    for (const rendition of RENDITIONS) {
      console.log(`[HLS] Transcoding ${rendition.name}…`);
      await transcodeRendition(rawLocalPath, tmpDir, rendition);
      console.log(`[HLS] ${rendition.name} done.`);
    }

    // Thumbnail, preview, and audio extraction in parallel
    const [, , audioExtracted] = await Promise.all([
      generateThumbnail(rawLocalPath, path.join(tmpDir, 'thumbnail.jpg'))
        .then(() => console.log('[HLS] thumbnail.jpg done.')),
      generatePreview(rawLocalPath, path.join(tmpDir, 'preview.mp4'))
        .then(() => console.log('[HLS] preview.mp4 done.')),
      extractAudio(rawLocalPath, audioPath)
        .then(() => { console.log('[AI] audio.mp3 done.'); return true; })
        .catch((err) => { console.warn('[AI] Audio extraction failed:', err.message); return false; }),
    ]);

    // ── Phase 2: Metadata (no AI) ─────────────────────────────────────────────
    console.log('[AI] Fetching video metadata and checking audio track…');
    const [{ title, description }, hasAudio] = await Promise.all([
      fetchVideoMeta(rawKey),
      Promise.resolve(checkHasAudio(rawLocalPath)),
    ]);
    console.log(`[AI] title="${title}" hasAudio=${hasAudio} audioExtracted=${audioExtracted}`);

    // ── Phase 3: Deterministic decision ──────────────────────────────────────
    const steps = decideSteps(hasAudio && audioExtracted);
    console.log('[AI] Steps:', steps);

    // ── Phase 4: Parallel AI ──────────────────────────────────────────────────
    console.log('[AI] Running parallel AI steps…');
    const [transcriptResult, visualResult] = await Promise.allSettled([
      // 4a: Whisper — only if we decided to transcribe
      steps.includes('transcribe')
        ? transcribeAudio(audioPath)
        : Promise.resolve(null),

      // 4b: Extract keyframes (sync) then describe with GPT-4o-mini vision
      Promise.resolve(extractKeyframes(rawLocalPath, framesDir))
        .then(frames => describeFrames(frames)),
    ]);

    const transcript    = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;
    const visualSummary = visualResult.status   === 'fulfilled' ? visualResult.value   : null;

    if (transcriptResult.status === 'rejected') console.warn('[AI] Transcript step rejected:', transcriptResult.reason);
    if (visualResult.status     === 'rejected') console.warn('[AI] Visual step rejected:',    visualResult.reason);

    // ── Phase 5: Synthesis ────────────────────────────────────────────────────
    console.log('[AI] Synthesizing aiSummary…');
    const aiSummary = await synthesizeSummary({ title, description, transcript, visualSummary });

    // ── Phase 6: Categorization ───────────────────────────────────────────────
    console.log('[AI] Categorizing…');
    const category = await categorize(aiSummary);

    // ── Upload all HLS + media files to S3 ────────────────────────────────────
    const masterContent = buildMasterPlaylist(RENDITIONS);
    fs.writeFileSync(path.join(tmpDir, 'master.m3u8'), masterContent);

    const hlsPrefix = `Videos/hls/${uuid}/`;
    const uploadable = fs.readdirSync(tmpDir).filter(f => {
      const fullPath = path.join(tmpDir, f);
      if (fs.statSync(fullPath).isDirectory()) return false; // skip frames/ dir
      if (f === path.basename(rawLocalPath)) return false;  // skip source video
      if (f === 'audio.mp3') return false;                  // audio is temp-only, not needed on S3
      return true;
    });

    console.log(`[HLS] Uploading ${uploadable.length} files to ${hlsPrefix}…`);
    for (const file of uploadable) {
      const contentType =
        file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' :
        file.endsWith('.ts')   ? 'video/mp2t'                    :
        file.endsWith('.mp4')  ? 'video/mp4'                     :
        file.endsWith('.jpg')  ? 'image/jpeg'                    :
                                 'application/octet-stream';
      await uploadToS3(path.join(tmpDir, file), BUCKET, hlsPrefix + file, contentType);
    }
    console.log('[HLS] Upload complete.');

    // ── Phase 7: Webhook → backend ────────────────────────────────────────────
    const masterHlsUrl = `${CLOUDFRONT_URL}/${hlsPrefix}master.m3u8`;
    const previewUrl   = `${CLOUDFRONT_URL}/${hlsPrefix}preview.mp4`;
    const thumbnailUrl = `${CLOUDFRONT_URL}/${hlsPrefix}thumbnail.jpg`;

    console.log(`[HLS] Calling webhook — category="${category}"`);
    await axios.post(
      `${BACKEND_URL}/api/internal/hls-complete`,
      { rawS3Key: rawKey, masterHlsUrl, previewUrl, thumbnailUrl, category, aiSummary },
      {
        headers: { 'Content-Type': 'application/json', 'x-hls-secret': HLS_WEBHOOK_SECRET },
        timeout: 15000,
      },
    );

    console.log('[HLS] Done ✓');
    return { statusCode: 200, body: 'OK' };

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};
