import express, { Router, Request, Response } from 'express';
import { googleLogin }            from '../controllers/auth.controller';
import { uploadController }       from '../controllers/upload.controller';
import { saveVideoController }    from '../controllers/saveVideo.controller';
import { VideoController }        from '../controllers/getVideo.controller';
import { CommentController }      from '../controllers/comment.controller';
import { authenticateJWT }        from '../services/auth.service';
import { WatchHistoryController } from '../controllers/watchHistory.controller';
import { adminStatsController }   from '../controllers/admin.controller';
import { hlsWebhookController }   from '../controllers/hlsWebhook.controller';

// ── Middleware ────────────────────────────────────────────────────────────────
import { validate }        from '../middleware/validate.middleware';
import { authLimiter, uploadLimiter, writeLimiter } from '../middleware/rateLimiter.middleware';
import { statsMiddleware } from '../middleware/stats.middleware';

// ── Schemas ───────────────────────────────────────────────────────────────────
import {
  googleLoginSchema,
  uploadUrlSchema,
  saveVideoSchema,
  videoIdParamSchema,
  createCommentSchema,
  updateCommentSchema,
  commentIdParamSchema,
  watchHistorySchema,
} from '../validators/schemas';

// ── Setup ─────────────────────────────────────────────────────────────────────
const router: Router          = express.Router();
const commentController       = new CommentController();
const watchHistoryController  = new WatchHistoryController();

// Count every API request for the dev dashboard
router.use(statsMiddleware);

// ── Admin guard (email-based) ─────────────────────────────────────────────────
const ADMIN_EMAIL = 'bkumar28899@gmail.com';
function requireAdmin(req: any, res: Response, next: any): void {
  if (req.user?.email !== ADMIN_EMAIL) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }
  next();
}

// Express v5 requires handlers to return void | Promise<void>.
// Controllers that use early `return res.json(...)` return Response, so we
// wrap them in a void-returning async function to satisfy the type checker
// without touching the controller implementations.
type H = (req: Request, res: Response) => Promise<any>;
const wrap = (fn: H) => async (req: Request, res: Response): Promise<void> => {
  await fn(req, res);
};

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post(
  '/google-login',
  authLimiter,
  validate(googleLoginSchema),
  googleLogin,
);

// ── Upload ────────────────────────────────────────────────────────────────────
router.post(
  '/upload-url',
  authenticateJWT,
  uploadLimiter,
  validate(uploadUrlSchema),
  uploadController,
);

router.post(
  '/save-video',
  authenticateJWT,
  uploadLimiter,
  validate(saveVideoSchema),
  saveVideoController,
);

// ── Feed — cursor-paginated + Redis cached ─────────────────────────────────────
// GET /api/feed?cursor=<id>&category=<cat>&limit=<n>
router.get('/feed',        wrap(VideoController.getFeed.bind(VideoController)));
// GET /api/feed/search?q=<term>
router.get('/feed/search', wrap(VideoController.searchFeed.bind(VideoController)));

// Legacy /home — redirects to /feed for backward compatibility
router.get('/home', wrap(VideoController.getFeed.bind(VideoController)));

// ── Video reads — SPECIFIC routes MUST come before /:videoId ─────────────────
router.get('/videos/top-liked', wrap(VideoController.getTopLikedVideos.bind(VideoController)));

router.get('/videos/liked',
  authenticateJWT,
  wrap(VideoController.getLikedVideos.bind(VideoController)),
);
router.get('/videos/disliked',
  authenticateJWT,
  wrap(VideoController.getDislikedVideos.bind(VideoController)),
);
router.get('/videos/mine',
  authenticateJWT,
  wrap(VideoController.getMyVideos.bind(VideoController)),
);

// View count — does NOT require authentication
router.post('/videos/:videoId/view', wrap(VideoController.recordView.bind(VideoController)));

// Parameterised routes after all literal-segment routes
router.get('/videos/:videoId/reaction',
  authenticateJWT,
  validate(videoIdParamSchema),
  wrap(VideoController.getUserReaction.bind(VideoController)),
);

router.get('/videos/:videoId', wrap(VideoController.getVideoById.bind(VideoController)));

// ── Video writes ──────────────────────────────────────────────────────────────
router.post('/videos/:videoId/like',
  authenticateJWT,
  writeLimiter,
  validate(videoIdParamSchema),
  wrap(VideoController.likeVideo.bind(VideoController)),
);

router.post('/videos/:videoId/dislike',
  authenticateJWT,
  writeLimiter,
  validate(videoIdParamSchema),
  wrap(VideoController.dislikeVideo.bind(VideoController)),
);

router.delete('/videos/:videoId',
  authenticateJWT,
  validate(videoIdParamSchema),
  wrap(VideoController.deleteVideo.bind(VideoController)),
);

// ── Comments ──────────────────────────────────────────────────────────────────
// Get replies route MUST come before the catch-all /:commentId routes
router.get('/comments/:commentId/replies',
  wrap((req, res) => commentController.getReplies(req, res)),
);

router.get('/videos/:videoId/comments',
  wrap((req, res) => commentController.getCommentsByVideoId(req, res)),
);

router.get('/videos/:videoId/comments/count',
  wrap((req, res) => commentController.getCommentCount(req, res)),
);

router.post('/videos/:videoId/comments',
  authenticateJWT,
  writeLimiter,
  validate(createCommentSchema),
  wrap((req, res) => commentController.createComment(req, res)),
);

router.put('/comments/:commentId',
  authenticateJWT,
  writeLimiter,
  validate(updateCommentSchema),
  wrap((req, res) => commentController.updateComment(req, res)),
);

router.delete('/comments/:commentId',
  authenticateJWT,
  validate(commentIdParamSchema),
  wrap((req, res) => commentController.deleteComment(req, res)),
);

router.get('/user/comments',
  authenticateJWT,
  wrap((req, res) => commentController.getCommentsByUserId(req, res)),
);

// ── Watch history ─────────────────────────────────────────────────────────────
router.post('/history/:videoId',
  authenticateJWT,
  writeLimiter,
  validate(watchHistorySchema),
  wrap((req, res) => watchHistoryController.upsertWatchHistory(req, res)),
);

router.get('/history',
  authenticateJWT,
  wrap((req, res) => watchHistoryController.getWatchHistory(req, res)),
);

// ── HLS webhook (called by Lambda after transcoding) ─────────────────────────
// No JWT — authenticated by x-hls-secret header instead.
router.post('/internal/hls-complete', wrap(hlsWebhookController));

// ── Admin ─────────────────────────────────────────────────────────────────────
router.get('/admin/stats',
  authenticateJWT,
  requireAdmin,
  wrap(adminStatsController),
);

export default router;
