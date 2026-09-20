import { Comment, IComment } from '../models/comment';
import { User } from '../models/user';

/**
 * Comments keep the avatar from when they were written. Swap in each author's
 * current one, so a changed profile picture shows on old comments too.
 */
async function withCurrentAvatars<T extends { user_id?: unknown; user_profile_image?: string | null }>(
  comments: T[],
): Promise<T[]> {
  const ids = [...new Set(comments.map(c => String(c.user_id)))].filter(id => /^[a-f\d]{24}$/i.test(id));
  if (!ids.length) return comments;
  const users = await User.find({ _id: { $in: ids } }, { profileImage: 1 }).lean().exec();
  const avatars = new Map(users.map(u => [String(u._id), u.profileImage || null]));
  return comments.map(c => {
    const id = String(c.user_id);
    return avatars.has(id) ? { ...c, user_profile_image: avatars.get(id) } : c;
  });
}

export class CommentService {
  async getCommentsByVideoId(videoId: string): Promise<IComment[]> {
    try {
      const comments = await Comment.find({ video_id: videoId, parent_id: null })
        .sort({ created_at: -1 })
        .lean()
        .exec();
      return (await withCurrentAvatars(comments)) as IComment[];
    } catch (error) {
      console.error('Error fetching comments:', error);
      throw new Error('Failed to fetch comments');
    }
  }

  async getReplies(parentCommentId: string): Promise<IComment[]> {
    try {
      const replies = await Comment.find({ parent_id: parentCommentId })
        .sort({ created_at: 1 })
        .lean()
        .exec();
      return (await withCurrentAvatars(replies)) as IComment[];
    } catch (error) {
      console.error('Error fetching replies:', error);
      throw new Error('Failed to fetch replies');
    }
  }

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

  async getCommentCount(videoId: string): Promise<number> {
    try {
      const count = await Comment.countDocuments({ video_id: videoId, parent_id: null });
      return count;
    } catch (error) {
      console.error('Error getting comment count:', error);
      throw new Error('Failed to get comment count');
    }
  }

  async getCommentsByUserId(userId: string): Promise<IComment[]> {
    try {
      const comments = await Comment.find({ user_id: userId })
        .sort({ created_at: -1 })
        .lean()
        .exec();
      return (await withCurrentAvatars(comments)) as IComment[];
    } catch (error) {
      console.error('Error fetching user comments:', error);
      throw new Error('Failed to fetch user comments');
    }
  }
} 