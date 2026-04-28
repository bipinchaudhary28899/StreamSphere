'use strict';

/**
 * aiWorker.js — AI pipeline + thumbnail + preview
 *
 * Invoked by the orchestrator in parallel with the rendition workers.
 * Owns everything that touches OpenAI/HuggingFace AND the two visual
 * assets (thumbnail.jpg, preview.mp4) that don't belong to any rendition.
 *
 * Lambda settings (configure in AWS console):
 *   Handler  : aiWorker.handler
 *   Memory   : 1024 MB   (ffmpeg for frames/audio + network-heavy AI calls)
 *   Timeout  : 10 min
 *   Layers   : ffmpeg binary layer (same as before)
 *
 * Event payload (sent by orchestrator):
 *   { bucket: string, rawKey: string, uuid: string }
 *
 * Return value (received by orchestrator via Payload):
 *   { aiSummary: string, category: string }
 *
 * Side-effects on S3 (before returning):
 *   Videos/hls/{uuid}/thumbnail.jpg
 *   Videos/hls/{uuid}/preview.mp4
 */

const { downloadFromS3, uploadToS3, ffmpeg, tmpFfmpeg } = require('./shared');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const { spawnSync } = require('child_process');

// ── Config ────────────────────────────────────────────────────────────────────
const CLOUDFRONT_URL     = (process.env.CLOUDFRONT_URL    || '').replace(/\/$/, '');
const BACKEND_URL        = (process.env.BACKEND_URL       || '').replace(/\/$/, '');
const HLS_WEBHOOK_SECRET = process.env.HLS_WEBHOOK_SECRET;
const OPENAI_API_KEY     = process.env.OPENAI_API_KEY;
const HF_API_KEY         = process.env.HUGGING_FACE_API_KEY;

// Identical category list to handler.js — anchoring order preserved
const CATEGORIES = [
  'Music', 'Gaming', 'Sports', 'Movies', 'Comedy', 'Web Series', 'Learning',
  'Podcasts', 'News', 'Fitness', 'Vlogs', 'Travel', 'Tech', 'Food & Recipes',
  'Motivation', 'Short Films', 'Art & Design', 'Fashion', 'Kids', 'History',
  'DIY', 'Documentaries', 'Spirituality', 'Real Estate', 'Automotive', 'Science',
  'Nature', 'Animals', 'Health & Wellness', 'Business & Finance',
  'Personal Development', 'Unboxing & Reviews', 'Live Streams',
  'Events & Conferences', 'Memes & Challenges', 'festivals', 'Interviews',
  'Trailers & Teasers', 'Animation', 'Magic & Illusions', 'Comedy Skits',
  'Parodies', 'Reaction Videos', 'ASMR',
];

// ════════════════════════════════════════════════════════════════════════════════
// FFmpeg helpers
// ════════════════════════════════════════════════════════════════════════════════

function generateThumbnail(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(1)
      .videoFilter('scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2')
      .outputOptions(['-vframes 1', '-q:v 2'])
      .output(outputPath)
      .on('end',   resolve)
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
      .on('end',   resolve)
      .on('error', (err) => reject(new Error(`Preview failed: ${err.message}`)))
      .run();
  });
}

function extractAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-t', '90',             // first 90 seconds — Whisper sweet spot
        '-vn',                  // drop video stream
        '-acodec', 'libmp3lame',
        '-q:a', '4',            // ~165 kbps
        '-ac', '1',             // mono — halves size, Whisper doesn't need stereo
      ])
      .output(outputPath)
      .on('end',   resolve)
      .on('error', (err) => reject(new Error(`Audio extraction failed: ${err.message}`)))
      .run();
  });
}

// Detect audio stream by parsing ffmpeg -i stderr (no ffprobe needed).
// Fails open (returns true) so we always attempt transcription on ambiguity.
function checkHasAudio(inputPath) {
  const result = spawnSync(tmpFfmpeg, ['-i', inputPath], { timeout: 10000 });
  const stderr  = result.stderr?.toString() ?? '';
  const hasAudio = stderr.includes('Audio:');
  console.log(`[AI] Audio stream detected: ${hasAudio}`);
  return hasAudio;
}

// Scene-change keyframe extraction — threshold 0.3 catches genuine cuts without
// firing on camera shakes. Capped at 5 frames to control cost.
function extractSceneFrames(inputPath, framesDir) {
  fs.mkdirSync(framesDir, { recursive: true });
  const result = spawnSync(tmpFfmpeg, [
    '-i', inputPath,
    '-vf', 'select=gt(scene\\,0.3),scale=512:288',
    '-vsync', 'vfr',
    '-q:v', '3',
    '-frames:v', '5',
    path.join(framesDir, 'scene_%03d.jpg'),
  ], { timeout: 30000 });

  if (result.status !== 0 && result.stderr) {
    console.warn('[AI] Scene detection stderr:', result.stderr.toString().slice(-300));
  }
  return fs.readdirSync(framesDir)
    .filter(f => f.startsWith('scene_'))
    .map(f => path.join(framesDir, f));
}

// Fallback: fixed timestamps (1s, 10s, 30s) — works for any video length.
function extractFallbackFrames(inputPath, framesDir) {
  const timestamps = [1, 10, 30];
  const frames = [];
  for (let i = 0; i < timestamps.length; i++) {
    const outputPath = path.join(framesDir, `fallback_${i}.jpg`);
    spawnSync(tmpFfmpeg, [
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

// ════════════════════════════════════════════════════════════════════════════════
// AI helpers (Phase 2–6 from original handler.js)
// ════════════════════════════════════════════════════════════════════════════════

async function fetchVideoMeta(rawS3Key) {
  try {
    const s3url = `${CLOUDFRONT_URL}/${rawS3Key}`;
    const res = await fetch(
      `${BACKEND_URL}/api/internal/video-meta?s3url=${encodeURIComponent(s3url)}`,
      { headers: { 'x-hls-secret': HLS_WEBHOOK_SECRET }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) { console.warn(`[AI] video-meta ${res.status}`); return { title: '', description: '' }; }
    return await res.json();
  } catch (err) {
    console.warn('[AI] fetchVideoMeta error:', err.message);
    return { title: '', description: '' };
  }
}

async function transcribeAudio(audioPath) {
  if (!OPENAI_API_KEY) { console.warn('[AI] OPENAI_API_KEY not set — skipping Whisper'); return null; }
  if (!audioPath || !fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1000) {
    console.log('[AI] Audio file absent or too small — skipping Whisper');
    return null;
  }
  try {
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
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) { console.warn(`[AI] Whisper HTTP ${res.status}`); return null; }
    const text = (await res.text()).trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
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

async function describeFrames(framePaths) {
  if (!framePaths.length) { console.log('[AI] No frames — skipping vision'); return null; }
  if (!OPENAI_API_KEY)    { console.warn('[AI] OPENAI_API_KEY not set — skipping vision'); return null; }
  try {
    const imageContent = framePaths.slice(0, 5).map(fp => ({
      type: 'image_url',
      image_url: {
        url: `data:image/jpeg;base64,${fs.readFileSync(fp).toString('base64')}`,
        detail: 'low',  // 85 tokens/image — 5 frames ≈ $0.00006
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
            { type: 'text', text: 'These are keyframes from a video. Describe: the type of content (tutorial, music video, gaming, vlog, etc.), the setting or environment, people or activity visible, and any text or branding on screen. 2–3 sentences, factual and specific.' },
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

async function synthesizeSummary({ title, description, transcript, visualSummary }) {
  const signals = [
    title         ? `Video title: ${title}`                                              : null,
    description   ? `Uploader description: ${description}`                               : null,
    transcript    ? `Spoken content (transcript): ${transcript.slice(0, 800)}`           : null,
    visualSummary ? `Visual content (from keyframes): ${visualSummary}`                  : null,
  ].filter(Boolean).join('\n\n');

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
    return signals;
  } catch (err) {
    console.warn('[AI] Synthesis error:', err.message);
    return [title, description, visualSummary].filter(Boolean).join('. ') || title || 'Video';
  }
}

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
            parameters: {
              candidate_labels: CATEGORIES,
              hypothesis_template: 'This video belongs to the {} genre or category.',
            },
          }),
          signal: AbortSignal.timeout(25000),
        },
      );

      if (res.ok) {
        const raw = await res.json();
        console.log('[AI] HuggingFace raw:', JSON.stringify(raw).slice(0, 300));
        const result = Array.isArray(raw) ? raw[0] : raw;
        let category = 'General';
        let score;
        if (result?.labels?.length) {
          category = result.labels[0];
          score    = result.scores?.[0];
        } else if (result?.label) {
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
  const { bucket, rawKey, uuid } = event;
  const BUCKET = bucket || process.env.AWS_S3_BUCKET_NAME;

  console.log(`[AI] Starting — source: ${rawKey}`);

  const tmpDir        = fs.mkdtempSync(path.join(os.tmpdir(), `ai-${uuid}-`));
  const rawLocalPath  = path.join(tmpDir, 'source' + path.extname(rawKey));
  const audioPath     = path.join(tmpDir, 'audio.mp3');
  const framesDir     = path.join(tmpDir, 'frames');
  const thumbnailPath = path.join(tmpDir, 'thumbnail.jpg');
  const previewPath   = path.join(tmpDir, 'preview.mp4');
  const hlsPrefix     = `Videos/hls/${uuid}/`;

  try {
    // ── Download source ────────────────────────────────────────────────────────
    console.log('[AI] Downloading source from S3…');
    await downloadFromS3(BUCKET, rawKey, rawLocalPath);
    console.log('[AI] Download complete.');

    // ── Thumbnail, preview, audio extraction — all in parallel ────────────────
    // These are independent: no output of one is the input of another.
    const [, , audioExtracted] = await Promise.all([
      generateThumbnail(rawLocalPath, thumbnailPath)
        .then(() => console.log('[AI] thumbnail.jpg done.')),
      generatePreview(rawLocalPath, previewPath)
        .then(() => console.log('[AI] preview.mp4 done.')),
      extractAudio(rawLocalPath, audioPath)
        .then(() => { console.log('[AI] audio.mp3 done.'); return true; })
        .catch((err) => { console.warn('[AI] Audio extraction failed:', err.message); return false; }),
    ]);

    // ── Upload thumbnail + preview immediately (don't wait for AI to finish) ──
    // Fire-and-forget upload promise; we await it before returning.
    const mediaUploadPromise = Promise.all([
      uploadToS3(thumbnailPath, BUCKET, `${hlsPrefix}thumbnail.jpg`, 'image/jpeg')
        .then(() => console.log('[AI] Uploaded thumbnail.jpg')),
      uploadToS3(previewPath, BUCKET, `${hlsPrefix}preview.mp4`, 'video/mp4')
        .then(() => console.log('[AI] Uploaded preview.mp4')),
    ]);

    // ── Metadata + audio stream check ─────────────────────────────────────────
    console.log('[AI] Fetching video metadata and checking audio stream…');
    const [{ title, description }, hasAudio] = await Promise.all([
      fetchVideoMeta(rawKey),
      Promise.resolve(checkHasAudio(rawLocalPath)),
    ]);
    console.log(`[AI] title="${title}" hasAudio=${hasAudio} audioExtracted=${audioExtracted}`);

    // ── Phase 4: Whisper + vision in parallel ──────────────────────────────────
    console.log('[AI] Running Whisper + vision in parallel…');
    const [transcriptResult, visualResult] = await Promise.allSettled([
      hasAudio && audioExtracted
        ? transcribeAudio(audioPath)
        : Promise.resolve(null),
      Promise.resolve(extractKeyframes(rawLocalPath, framesDir))
        .then(frames => describeFrames(frames)),
    ]);

    const transcript    = transcriptResult.status === 'fulfilled' ? transcriptResult.value : null;
    const visualSummary = visualResult.status     === 'fulfilled' ? visualResult.value     : null;

    if (transcriptResult.status === 'rejected') console.warn('[AI] Transcript step rejected:', transcriptResult.reason);
    if (visualResult.status     === 'rejected') console.warn('[AI] Visual step rejected:',    visualResult.reason);

    // ── Phase 5 + 6: Synthesis → Categorization (sequential — cat needs summary)
    console.log('[AI] Synthesizing aiSummary…');
    const aiSummary = await synthesizeSummary({ title, description, transcript, visualSummary });

    console.log('[AI] Categorizing…');
    const category = await categorize(aiSummary);

    // ── Ensure media uploads are done before returning ─────────────────────────
    await mediaUploadPromise;

    console.log(`[AI] Done ✅  category="${category}"`);
    return { aiSummary, category };

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};
