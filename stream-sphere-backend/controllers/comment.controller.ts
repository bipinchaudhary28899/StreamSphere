import { Request, Response } from 'express';
import { CommentService } from '../services/comment.service';

const commentService = new CommentService();

interface AuthenticatedRequest extends Request {
  user?: { userId: string; name?: string; email: string; profileImage?: string };
}

export class CommentController {
  async getCommentsByVideoId(req: Request, res: Response) {
    try {
      const { videoId } = req.params;
      if (\!videoId) return res.status(400).json({ error: 'Video ID is required' });
      const comments = await commentService.getCommentsByVideoId(videoId);
      res.status(200).json({ success: true, comments });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch comments' });
    }
  }

  async createComment(req: AuthenticatedRequest, res: Response) {
    try {
      const { video_id, content, parent_id } = req.body;
      const user = req.user;
      if (\!user)                           return res.status(401).json({ error: 'User not authenticated' });
      if (\!video_id || \!content)           return res.status(400).json({ error: 'Video ID and content are required' });
      if (content.trim().length === 0)     return res.status(400).json({ error: 'Comment content cannot be empty' });
      if (content.length > 1000)           return res.status(400).json({ error: 'Comment content cannot exceed 1000 characters' });

      const comment = await commentService.createComment({
        video_id,
        user_id:           user.userId,
        username:          user.name || user.email,
        user_profile_image: user.profileImage || undefined,
        content:           content.trim(),
        parent_id:         parent_id || undefined,
      });
      res.status(201).json({ success: true, comment });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create comment' });
    }
  }

  async updateComment(req: AuthenticatedRequest, res: Response) {
    try {
      const { commentId } = req.params;
      const { content }   = req.body;
      const user          = req.user;
      if (\!user)                       return res.status(401).json({ error: 'User not authenticated' });
      if (\!content)                    return res.status(400).json({ error: 'Content is required' });
      if (content.trim().length === 0) return res.status(400).json({ error: 'Comment content cannot be empty' });
      if (content.length > 1000)       return res.status(400).json({ error: 'Comment content cannot exceed 1000 characters' });

      const updatedComment = await commentService.updateComment(commentId, user.userId, content.trim());
      if (\!updatedComment) return res.status(404).json({ error: 'Comment not found or unauthorized' });
      res.status(200).json({ success: true, comment: updatedComment });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update comment' });
    }
  }

  async deleteComment(req: AuthenticatedRequest, res: Response) {
    try {
      const { commentId } = req.params;
      const user          = req.user;
      if (\!user) return res.status(401).json({ error: 'User not authenticated' });
      const deleted = await commentService.deleteComment(commentId, user.userId);
      if (\!deleted) return res.status(404).json({ error: 'Comment not found or unauthorized' });
      res.status(200).json({ success: true, message: 'Comment deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete comment' });
    }
  }

  async getCommentCount(req: Request, res: Response) {
    try {
      const { videoId } = req.params;
      if (\!videoId) return res.status(400).json({ error: 'Video ID is required' });
      const count = await commentService.getCommentCount(videoId);
      res.status(200).json({ success: true, count });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get comment count' });
    }
  }

  async getCommentsByUserId(req: AuthenticatedRequest, res: Response) {
    try {
      const user = req.user;
      if (\!user) return res.status(401).json({ error: 'User not authenticated' });
      const comments = await commentService.getCommentsByUserId(user.userId);
      res.status(200).json({ success: true, comments });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch user comments' });
    }
  }

  async getReplies(req: Request, res: Response) {
    try {
      const { commentId } = req.params;
      if (\!commentId) return res.status(400).json({ error: 'Comment ID is required' });
      const replies = await commentService.getReplies(commentId);
      res.status(200).json({ success: true, replies });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch replies' });
    }
  }
}
