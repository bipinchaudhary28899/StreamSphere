// services/getVideo.service.ts
import mongoose from 'mongoose';
import { Video } from '../models/video';
import { User } from '../models/user';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { redisService, CK, TTL } from './redis.service';

async function populateUserImages(videos: any[]): Promise<any[]> {
  if (!videos.length) return videos;
  const userIds = [...new Set(videos.map((v: any) => v.user_id).filter(Boolean))];
  const users = await User.find(
    { _id: { $in: userIds } },
    { _id: 1, profileImage: 1 },
  ).lean().exec();
  const profileMap = new Map(
    (users as any[]).map((u) => [u._id.toString(), u.profileImage || null]),
  );
  return videos.map((v: any) => ({
    ...v,
    user_profile_image: profileMap.get(v.user_id) ?? v.user_profile_image ?? null,
  }));
}

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const PAGE_SIZE = 10; // cards per page

export interface FeedPage {
  videos:     any[];
  nextCursor: string | null;  // _id of the last item, null when no more pages
  hasMore:    boolean;
}

export class VideoService {

  async getPaginatedFeed(
    cursor?: string,
    category?: string,
    limit = PAGE_SIZE,
  ): Promise<FeedPage> {
    const cursorKey = cursor || 'first';
    const cacheKey  = category && category !== 'All'
      ? CK.feedCat(category, cursorKey)
      : CK.feedAll(cursorKey);

    const cached = await redisService.get<FeedPage>(cacheKey);
    if (cached) return cached;

    // Only surface fully-transcoded videos; 'processing' ones are hidden from
    // the public feed until the HLS Lambda flips their status to 'ready'.
    const filter: Record<string, any> = { status: 'ready' };

    if (category && category !== 'All') {
      filter.category = category;
    }

    if (cursor) {
      if (!mongoose.Types.ObjectId.isValid(cursor)) {
        throw new Error('Invalid cursor');
      }
      filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }

    const docs = await Video
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    const hasMore    = docs.length > limit;
    const rawVideos  = hasMore ? docs.slice(0, limit) : docs;
    const nextCursor = hasMore ? String(rawVideos[rawVideos.length - 1]._id) : null;

    const videos = await populateUserImages(rawVideos);
    const page: FeedPage = { videos, nextCursor, hasMore };

    await redisService.set(cacheKey, page, TTL.feed);

    return page;
  }

  async searchVideos(term: string, category?: string): Promise<any[]> {
    // Build a cache key that incorporates the active category so that
    // "football" in Sports and "football" in All are cached separately.
    const catSuffix = category && category !== 'All'
      ? `:${encodeURIComponent(category)}`
      : '';
    const cacheKey = CK.search(term) + catSuffix;

    const cached = await redisService.get<any[]>(cacheKey);
    if (cached) return cached;

    const regex = new RegExp(term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const filter: Record<string, any> = {
      $or: [{ title: regex }, { description: regex }],
    };

    if (category && category !== 'All') {
      filter.category = category;
    }

    const results = await Video
      .find(filter)
      .sort({ _id: -1 })
      .limit(60)
      .lean()
      .exec();

    const populated = await populateUserImages(results);
    await redisService.set(cacheKey, populated, TTL.search);
    return populated;
  }


  async getTopLikedVideos(): Promise<any[]> {
    const cached = await redisService.get<any[]>(CK.topLiked());
    if (cached) return cached;

    const raw = await Video.find({}).sort({ likes: -1 }).limit(3).lean().exec();
    const videos = await populateUserImages(raw);
    await redisService.set(CK.topLiked(), videos, TTL.topLiked);
    return videos;
  }


  async getVideoById(id: string): Promise<any | null> {
    const cached = await redisService.get<any>(CK.singleVideo(id));
    if (cached) return cached;

    const video = await Video.findById(id).lean().exec();
    if (video) await redisService.set(CK.singleVideo(id), video, TTL.video);
    return video;
  }

  async getVideoByUrl(S3_url: string) {
    return await Video.findOne({ S3_url }).exec();
  }


  async getLikedVideos(userId: string) {
    return await Video.find({ likedBy: userId }).sort({ _id: -1 }).lean().exec();
  }

  async getDislikedVideos(userId: string) {
    return await Video.find({ dislikedBy: userId }).sort({ _id: -1 }).lean().exec();
  }

  async getMyVideos(userId: string) {
    return await Video.find({ user_id: userId }).sort({ _id: -1 }).lean().exec();
  }


  async likeVideo(videoId: string, userId: string) {
    const video = await Video.findById(videoId);
    if (!video) throw new Error('Video not found');

    if (video.likedBy.includes(userId)) {
      video.likedBy = video.likedBy.filter(id => id !== userId);
      video.likes   = Math.max(0, video.likes - 1);
    } else {
      video.likedBy.push(userId);
      video.likes += 1;
      if (video.dislikedBy.includes(userId)) {
        video.dislikedBy = video.dislikedBy.filter(id => id !== userId);
        video.dislikes   = Math.max(0, video.dislikes - 1);
      }
    }

    await video.save();

    // Bust single-video cache + top-liked (likes changed)
    await Promise.all([
      redisService.del(CK.singleVideo(videoId)),
      redisService.del(CK.topLiked()),
    ]);

    return video;
  }

  async dislikeVideo(videoId: string, userId: string) {
    const video = await Video.findById(videoId);
    if (!video) throw new Error('Video not found');

    if (video.dislikedBy.includes(userId)) {
      video.dislikedBy = video.dislikedBy.filter(id => id !== userId);
      video.dislikes   = Math.max(0, video.dislikes - 1);
    } else {
      video.dislikedBy.push(userId);
      video.dislikes += 1;
      if (video.likedBy.includes(userId)) {
        video.likedBy = video.likedBy.filter(id => id !== userId);
        video.likes   = Math.max(0, video.likes - 1);
      }
    }

    await video.save();

    await Promise.all([
      redisService.del(CK.singleVideo(videoId)),
      redisService.del(CK.topLiked()),
    ]);

    return video;
  }

  async getUserReaction(videoId: string, userId: string) {
    const video = await Video.findById(videoId);
    if (!video) return null;
    if (video.likedBy.includes(userId))    return 'liked';
    if (video.dislikedBy.includes(userId)) return 'disliked';
    return 'none';
  }


  async deleteVideo(videoId: string, userId: string) {
    const video = await Video.findById(videoId);
    if (!video) throw new Error('Video not found');
    if (video.user_id !== userId) throw new Error('Unauthorized: You can only delete your own videos');

    const bucket = process.env.AWS_S3_BUCKET_NAME!;

    // ── Delete raw source file ────────────────────────────────────────────────
    const s3Url = video.S3_url;
    const rawKey = s3Url.includes('cloudfront.net')
      ? s3Url.split('cloudfront.net/')[1]
      : s3Url.split('.amazonaws.com/')[1];

    if (!rawKey) throw new Error('Could not extract S3 key from S3_url');

    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: rawKey }));

    // ── Delete HLS renditions (Videos/hls/<uuid>/ prefix) ────────────────────
    // Extract the uuid segment from the raw key: Videos/raw/<uuid>/filename
    const uuidMatch = rawKey.match(/Videos\/raw\/([^/]+)\//);
    if (uuidMatch) {
      const hlsPrefix = `Videos/hls/${uuidMatch[1]}/`;
      const listed = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: hlsPrefix,
      }));
      if (listed.Contents && listed.Contents.length > 0) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: listed.Contents.map(obj => ({ Key: obj.Key! })),
            Quiet: true,
          },
        }));
      }
    }

    await Video.findByIdAndDelete(videoId);

    // Bust all feed caches for this video's category + all-feed
    await Promise.all([
      redisService.delPattern('ss:feed:all:*'),
      redisService.delPattern(`ss:feed:cat:${encodeURIComponent(video.category)}:*`),
      redisService.del(CK.singleVideo(videoId)),
      redisService.del(CK.topLiked()),
    ]);
  }


  async recordView(videoId: string, userId?: string): Promise<number> {
    const viewKey = `ss:view:${videoId}:${userId ?? 'anon'}`;
    const TTL_24H = 86400;

    // Check if view already counted (try to get the key)
    const alreadyCounted = await redisService.get<string>(viewKey);
    if (alreadyCounted) return -1;

    // Set Redis key with 24h TTL
    await redisService.set(viewKey, '1', TTL_24H);

    // Atomically increment views on the Video document
    const video = await Video.findByIdAndUpdate(
      videoId,
      { $inc: { views: 1 } },
      { new: true }
    );

    if (!video) throw new Error('Video not found');

    // Bust single-video cache
    await redisService.del(CK.singleVideo(videoId));

    return video.views;
  }
}
