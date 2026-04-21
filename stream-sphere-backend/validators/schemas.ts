import { z } from 'zod';

// ── Reusable primitives ───────────────────────────────────────────────────────

/** Matches a 24-char hex MongoDB ObjectId */
const mongoId = z
  .string({ error: 'ID is required' })
  .regex(/^[a-f\d]{24}$/i, 'Invalid ID format');

/** Non-empty trimmed string with a max length */
const nonEmptyString = (label: string, max = 255) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} cannot be empty`)
    .max(max, `${label} cannot exceed ${max} characters`);

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * POST /api/google-login
 * Body: { token }
 */
export const googleLoginSchema = z.object({
  body: z.object({
    token: z.string({ error: 'Google credential token is required' })
            .min(1, 'Token cannot be empty'),
  }),
});

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * POST /api/upload-url
 * Body: { filename, filetype }
 */
export const uploadUrlSchema = z.object({
  body: z.object({
    filename: nonEmptyString('Filename', 255),
    filetype: z
      .string({ error: 'File type is required' })
      .regex(/^video\//i, 'Only video file types are allowed (e.g. video/mp4)'),
  }),
});

/**
 * POST /api/save-video
 * Body: { title, description?, S3_url, user_id, userName }
 */
export const saveVideoSchema = z.object({
  body: z.object({
    title:       nonEmptyString('Title', 200),
    description: z.string().trim().max(2000, 'Description cannot exceed 2000 characters').optional(),
    S3_url:      z.string({ error: 'S3 URL is required' }).url('S3_url must be a valid URL'),
    user_id:     nonEmptyString('User ID', 100),
    userName:    nonEmptyString('User name', 100),
  }),
});

// ── Video interactions ────────────────────────────────────────────────────────

/**
 * POST /api/videos/:videoId/like
 * POST /api/videos/:videoId/dislike
 * GET  /api/videos/:videoId/reaction
 * DELETE /api/videos/:videoId
 * Params: { videoId }
 */
export const videoIdParamSchema = z.object({
  params: z.object({
    videoId: mongoId,
  }),
});

// ── Comments ──────────────────────────────────────────────────────────────────

/**
 * POST /api/videos/:videoId/comments
 * Params: { videoId }
 * Body:   { video_id, content }
 */
export const createCommentSchema = z.object({
  params: z.object({
    videoId: mongoId,
  }),
  body: z.object({
    video_id: mongoId,
    content:  nonEmptyString('Comment content', 1000),
  }),
});

/**
 * PUT /api/comments/:commentId
 * Params: { commentId }
 * Body:   { content }
 */
export const updateCommentSchema = z.object({
  params: z.object({
    commentId: mongoId,
  }),
  body: z.object({
    content: nonEmptyString('Comment content', 1000),
  }),
});

/**
 * DELETE /api/comments/:commentId
 * Params: { commentId }
 */
export const commentIdParamSchema = z.object({
  params: z.object({
    commentId: mongoId,
  }),
});

// ── Watch history ─────────────────────────────────────────────────────────────

/**
 * POST /api/history/:videoId
 * Params: { videoId }
 */
export const watchHistorySchema = z.object({
  params: z.object({
    videoId: mongoId,
  }),
});
