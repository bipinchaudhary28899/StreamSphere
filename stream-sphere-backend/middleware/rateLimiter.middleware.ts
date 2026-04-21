import rateLimit from 'express-rate-limit';

/**
 * Shared error-response formatter so every limiter returns the same JSON
 * shape and no HTML leaks through to API clients.
 */
const jsonMessage = (msg: string) => ({ error: msg });

// ── Tier 1 — Auth  ────────────────────────────────────────────────────────────
/**
 * Applied to: POST /api/google-login
 *
 * 10 attempts per IP per 15 minutes.
 * Brute-forcing OAuth tokens is the most damaging attack vector here; this
 * makes it extremely slow even if an attacker has many tokens to try.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,   // Return RateLimit-* headers (RFC 6585)
  legacyHeaders: false,     // Disable X-RateLimit-* headers
  message: jsonMessage('Too many login attempts — please wait 15 minutes and try again.'),
});

// ── Tier 2 — Upload  ──────────────────────────────────────────────────────────
/**
 * Applied to: POST /api/upload-url  and  POST /api/save-video
 *
 * 20 requests per IP per hour.
 * Uploading and saving videos involves real cost (S3 bandwidth, ffprobe,
 * HuggingFace API calls). 20/hr is generous for a real user but kills bots.
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Upload limit reached — you can upload up to 20 videos per hour.'),
});

// ── Tier 3 — Write operations  ────────────────────────────────────────────────
/**
 * Applied to: like, dislike, comment (create/update/delete), watch history
 *
 * 60 requests per IP per 15 minutes (~4 per minute).
 * High enough that a real user watching and interacting with several videos
 * never hits it, but low enough to prevent spam-liking or comment flooding.
 */
export const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many requests — please slow down and try again shortly.'),
});

// ── Tier 4 — Global / read  ───────────────────────────────────────────────────
/**
 * Applied globally in index.ts as the last-resort backstop.
 *
 * 300 requests per IP per 15 minutes (~20 per minute).
 * Covers all read endpoints (home feed, video details, comments, categories).
 * A legitimate user browsing the platform comfortably fits within this.
 *
 * ⚠️  Vercel / serverless note: express-rate-limit's default MemoryStore does
 * not share state across serverless function instances. For production at
 * scale, swap it for a Redis store (e.g. rate-limit-redis).  For a
 * single-instance or low-traffic Vercel deployment this is still effective.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many requests from this IP — please try again in 15 minutes.'),
});
