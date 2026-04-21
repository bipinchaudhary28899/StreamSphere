import { Comment, IComment } from '../models/comment';

export class CommentService {
  // Get all top-level comments for a video (exclude replies)
  async getCommentsByVideoId(videoId: string): Promise<IComment[]> {
    try {
      const comments = await Comment.find({ video_id: videoId, parent_id: null })
        .sort({ created_at: -1 })
        .exec();
      return comments;
    } catch (error) {
      console.error('Error fetching comments:', error);
      throw new Error('Failed to fetch comments');
    }
  }

  // Get replies to a comment
  async getReplies(parentCommentId: string): Promise<IComment[]> {
    try {
      const replies = await Comment.find({ parent_id: parentCommentId })
        .sort({ created_at: 1 })
        .exec();
      return replies;
    } catch (error) {
      console.error('Error fetching replies:', error);
      throw new Error('Failed to fetch replies');
    }
  }

  // Create a new comment or reply
  async createComment(commentData: {
    video_id: string;
    user_id: string;
    username: string;
    user_profile_image?: string;
    content: string;
    parent_id?: string | null;
  }): Promise<IComment> {
    try {
      const comment = new Comment(commentData);
      const savedComment = await comment.save();

      // If this is a reply, increment parent's replies_count
      if (commentData.parent_id) {
        await Comment.findByIdAndUpdate(
          commentData.parent_id,
          { $inc: { replies_count: 1 } }
        );
      }

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

  // Delete a comment or reply
  async deleteComment(commentId: string, userId: string): Promise<boolean> {
    try {
      const comment = await Comment.findById(commentId);
      if (!comment || comment.user_id !== userId) {
        return false;
      }

      // If this is a reply, decrement parent's replies_count
      if (comment.parent_id) {
        await Comment.findByIdAndUpdate(
          comment.parent_id,
          { $inc: { replies_count: -1 } }
        );
      } else {
        // If this is a top-level comment, delete all its replies
        await Comment.deleteMany({ parent_id: commentId });
      }

      // Delete the comment itself
      await Comment.findByIdAndDelete(commentId);
      return true;
    } catch (error) {
      console.error('Error deleting comment:', error);
      throw new Error('Failed to delete comment');
    }
  }

  // Get comment count for a video (top-level only)
  async getCommentCount(videoId: string): Promise<number> {
    try {
      const count = await Comment.countDocuments({ video_id: videoId, parent_id: null });
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