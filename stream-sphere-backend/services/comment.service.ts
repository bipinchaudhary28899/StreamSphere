import { Comment, IComment } from '../models/comment';

export class CommentService {
  // Get all comments for a video
  async getCommentsByVideoId(videoId: string): Promise<IComment[]> {
    try {
      const comments = await Comment.find({ video_id: videoId })
        .sort({ created_at: -1 })
        .exec();
      return comments;
    } catch (error) {
      console.error('Error fetching comments:', error);
      throw new Error('Failed to fetch comments');
    }
  }

  // Create a new comment
  async createComment(commentData: {
    video_id: string;
    user_id: string;
    username: string;
    user_profile_image?: string;
    content: string;
  }): Promise<IComment> {
    try {
      const comment = new Comment(commentData);
      const savedComment = await comment.save();
      return savedComment;
    } catch (error) {
      console.error('Error creating comment:', error);
      throw new Error('Failed to create comment');
    }
  }

  // Update a comment
  async updateComment(commentId: string, userId: string, content: string): Promise<IComment | null> {
    try {
      const comment = await Comment.findOneAndUpdate(
        { _id: commentId, user_id: userId },
        { content, updated_at: new Date() },
        { new: true }
      );
      return comment;
    } catch (error) {
      console.error('Error updating comment:', error);
      throw new Error('Failed to update comment');
    }
  }

  // Delete a comment
  async deleteComment(commentId: string, userId: string): Promise<boolean> {
    try {
      const result = await Comment.findOneAndDelete({ _id: commentId, user_id: userId });
      return !!result;
    } catch (error) {
      console.error('Error deleting comment:', error);
      throw new Error('Failed to delete comment');
    }
  }

  // Get comment count for a video
  async getCommentCount(videoId: string): Promise<number> {
    try {
      const count = await Comment.countDocuments({ video_id: videoId });
      return count;
    } catch (error) {
      console.error('Error getting comment count:', error);
      throw new Error('Failed to get comment count');
    }
  }

  // Get comments by user
  async getCommentsByUserId(userId: string): Promise<IComment[]> {
    try {
      const comments = await Comment.find({ user_id: userId })
        .sort({ created_at: -1 })
        .exec();
      return comments;
    } catch (error) {
      console.error('Error fetching user comments:', error);
      throw new Error('Failed to fetch user comments');
    }
  }
} 