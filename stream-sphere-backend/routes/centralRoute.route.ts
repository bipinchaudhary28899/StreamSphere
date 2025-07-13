import express, { Router, Request, Response } from 'express';  // Use import here
import { googleLogin } from '../controllers/auth.controller';
import { uploadController } from '../controllers/upload.controller';
import { saveVideoController } from '../controllers/saveVideo.controller';
import { VideoController } from '../controllers/getVideo.controller';
import { CommentController } from '../controllers/comment.controller';
import { authenticateJWT } from '../services/auth.service';

const router: Router = express.Router();
const commentController = new CommentController();

router.post('/google-login', googleLogin);
router.post('/upload-url', uploadController);
router.post('/save-video', saveVideoController);
router.get('/home', VideoController.getVideos);
router.get('/videos/category/:category', VideoController.getVideosByCategory);

// Specific routes must come before parameterized routes
router.get('/videos/top-liked', async (req: Request, res: Response) => {
  await VideoController.getTopLikedVideos(req, res);
});
router.get('/videos/liked', authenticateJWT, async (req: Request, res: Response) => {
  await VideoController.getLikedVideos(req, res);
});
router.get('/videos/disliked', authenticateJWT, async (req: Request, res: Response) => {
  await VideoController.getDislikedVideos(req, res);
});

// Parameterized routes come after specific routes
router.post('/videos/:videoId/like', authenticateJWT, async (req: Request, res: Response) => {
  await VideoController.likeVideo(req, res);
});
router.post('/videos/:videoId/dislike', authenticateJWT, async (req: Request, res: Response) => {
  await VideoController.dislikeVideo(req, res);
});
router.get('/videos/:videoId/reaction', authenticateJWT, async (req: Request, res: Response) => {
  await VideoController.getUserReaction(req, res);
});
router.delete('/videos/:videoId', async (req: Request, res: Response) => {
  await VideoController.deleteVideo(req, res);
});

// Comment routes
router.get('/videos/:videoId/comments', async (req: Request, res: Response) => {
  await commentController.getCommentsByVideoId(req, res);
});
router.post('/videos/:videoId/comments', authenticateJWT, async (req: Request, res: Response) => {
  await commentController.createComment(req, res);
});
router.put('/comments/:commentId', authenticateJWT, async (req: Request, res: Response) => {
  await commentController.updateComment(req, res);
});
router.delete('/comments/:commentId', authenticateJWT, async (req: Request, res: Response) => {
  await commentController.deleteComment(req, res);
});
router.get('/videos/:videoId/comments/count', async (req: Request, res: Response) => {
  await commentController.getCommentCount(req, res);
});
router.get('/user/comments', authenticateJWT, async (req: Request, res: Response) => {
  await commentController.getCommentsByUserId(req, res);
});

export default router;
