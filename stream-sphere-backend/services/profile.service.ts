// services/profile.service.ts
import { randomUUID } from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { User, IUser, AvatarSource, BannerSource } from '../models/user';
import { Video } from '../models/video';
import { redisService, CK } from './redis.service';

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

// Profile images live under Videos/ so the existing CloudFront distribution
// serves them — but never under Videos/raw/, which triggers the transcoder.
const PROFILE_PREFIX = 'Videos/profiles';

/** Every upload gets a fresh key, so its bytes never change. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Uploads not saved to the profile within this window are swept as abandoned. */
const ABANDONED_AFTER_MS = 10 * 60 * 1000;

export type ImageKind = 'avatar' | 'banner';
export type ImageContentType = 'image/webp' | 'image/jpeg';

export const MAX_IMAGE_BYTES: Record<ImageKind, number> = {
  avatar: 1024 * 1024,
  banner: 2 * 1024 * 1024,
};

const EXTENSION: Record<ImageContentType, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
};

// Preset ids must match the SVGs in stream-sphere-client/src/assets/profile/
// and the list in stream-sphere-client/src/app/shared/profile-presets.ts.
export const AVATAR_PRESETS = ['pulse', 'ember', 'orbit', 'lagoon', 'nebula', 'prism', 'bloom', 'midnight'] as const;
export const BANNER_PRESETS = ['aurora', 'sunset', 'ocean', 'synthwave', 'candy', 'confetti', 'noir', 'studio'] as const;

export type AvatarChoice =
  | { source: 'upload'; key: string }
  | { source: 'preset'; presetId: string }
  | { source: 'google' }
  | { source: 'initials' };

export type BannerChoice =
  | { source: 'upload'; key: string }
  | { source: 'preset'; presetId: string }
  | { source: 'default' };

export class ProfileError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The profile fields the client needs, in one shape for login and /profile */
export function toProfile(user: IUser) {
  const avatarSource: AvatarSource = user.avatarSource ?? 'google';
  return {
    userId: String(user._id),
    name: user.name,
    email: user.email,
    profileImage: user.profileImage || '',
    avatarSource,
    // Accounts from before custom avatars only have profileImage, which is
    // the Google photo while they still use it.
    googlePicture: user.googlePicture || (avatarSource === 'google' ? user.profileImage || '' : ''),
    bannerSource: (user.bannerSource ?? 'default') as BannerSource,
    bannerImage: user.bannerImage || '',
  };
}

const presetUrl = (folder: 'avatars' | 'banners', id: string) => `/assets/profile/${folder}/${id}.svg`;
const cdnUrl = (key: string) => `${process.env.CLOUDFRONT_URL}/${key}`;
const userPrefix = (userId: string) => `${PROFILE_PREFIX}/${userId}/`;

/** True for keys this server signed for this user and kind of image */
function isOwnKey(userId: string, kind: ImageKind, key: string): boolean {
  const pattern = new RegExp(
    `^${PROFILE_PREFIX}/${userId}/${kind}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(webp|jpg)$`,
  );
  return pattern.test(key);
}

/**
 * Signs a single PUT for a cropped avatar or banner. The signature covers the
 * type, exact size and cache header, so S3 rejects any other upload.
 */
export async function createImageUpload(
  userId: string,
  kind: ImageKind,
  contentType: ImageContentType,
  size: number,
): Promise<{ uploadUrl: string; key: string; headers: Record<string, string> }> {
  if (size > MAX_IMAGE_BYTES[kind]) {
    const limit = MAX_IMAGE_BYTES[kind] / (1024 * 1024);
    throw new ProfileError(413, `The image is too large. The limit is ${limit} MB.`);
  }

  const key = `${userPrefix(userId)}${kind}-${randomUUID()}.${EXTENSION[contentType]}`;
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
    CacheControl: IMMUTABLE,
  });
  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: 300,
    signableHeaders: new Set(['content-type', 'cache-control']),
  });

  return { uploadUrl, key, headers: { 'Content-Type': contentType, 'Cache-Control': IMMUTABLE } };
}

export async function getProfile(userId: string): Promise<IUser> {
  const user = await User.findById(userId);
  if (!user) throw new ProfileError(404, 'Account not found');
  return user;
}

export async function updateProfile(
  userId: string,
  changes: { avatar?: AvatarChoice; banner?: BannerChoice },
): Promise<IUser> {
  const user = await getProfile(userId);
  const previousAvatar = user.profileImage;
  const previousKeys = [user.avatarKey, user.bannerKey].filter((k): k is string => !!k);

  if (changes.avatar) applyAvatar(user, changes.avatar);
  if (changes.banner) applyBanner(user, changes.banner);

  await user.save();

  // Both are best-effort: the profile is already saved.
  const results = await Promise.allSettled([
    sweepUnusedImages(user, previousKeys),
    user.profileImage !== previousAvatar ? invalidateAvatarCaches(userId) : Promise.resolve(),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') console.warn('[profile] cleanup failed:', result.reason?.message ?? result.reason);
  }

  return user;
}

function applyAvatar(user: IUser, choice: AvatarChoice): void {
  // Accounts from before custom avatars never stored the Google photo on its
  // own: keep it before it is replaced, so "Google photo" can bring it back.
  if (!user.googlePicture && (user.avatarSource ?? 'google') === 'google' && user.profileImage) {
    user.googlePicture = user.profileImage;
  }

  switch (choice.source) {
    case 'upload':
      if (!isOwnKey(String(user._id), 'avatar', choice.key)) {
        throw new ProfileError(400, 'That image isn’t available. Upload it again.');
      }
      user.avatarKey = choice.key;
      user.profileImage = cdnUrl(choice.key);
      break;
    case 'preset':
      if (!(AVATAR_PRESETS as readonly string[]).includes(choice.presetId)) {
        throw new ProfileError(400, 'Unknown avatar');
      }
      user.avatarKey = undefined;
      user.profileImage = presetUrl('avatars', choice.presetId);
      break;
    case 'google':
      if (!user.googlePicture) throw new ProfileError(400, 'This account has no Google photo');
      user.avatarKey = undefined;
      user.profileImage = user.googlePicture;
      break;
    case 'initials':
      user.avatarKey = undefined;
      user.profileImage = '';
      break;
  }
  user.avatarSource = choice.source;
}

function applyBanner(user: IUser, choice: BannerChoice): void {
  switch (choice.source) {
    case 'upload':
      if (!isOwnKey(String(user._id), 'banner', choice.key)) {
        throw new ProfileError(400, 'That image isn’t available. Upload it again.');
      }
      user.bannerKey = choice.key;
      user.bannerImage = cdnUrl(choice.key);
      break;
    case 'preset':
      if (!(BANNER_PRESETS as readonly string[]).includes(choice.presetId)) {
        throw new ProfileError(400, 'Unknown banner');
      }
      user.bannerKey = undefined;
      user.bannerImage = presetUrl('banners', choice.presetId);
      break;
    case 'default':
      user.bannerKey = undefined;
      user.bannerImage = undefined;
      break;
  }
  user.bannerSource = choice.source;
}

/**
 * Deletes the user's uploads that the profile no longer uses: replaced images
 * and uploads that were never saved. Recent unsaved uploads are kept, since
 * another tab may be about to save them.
 */
async function sweepUnusedImages(user: IUser, replacedKeys: string[]): Promise<void> {
  const keep = new Set([user.avatarKey, user.bannerKey].filter(Boolean));
  const replaced = new Set(replacedKeys);
  const listed = await s3.send(new ListObjectsV2Command({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Prefix: userPrefix(String(user._id)),
  }));

  const cutoff = Date.now() - ABANDONED_AFTER_MS;
  const stale = (listed.Contents ?? [])
    .map(obj => ({ key: obj.Key ?? '', modified: obj.LastModified?.getTime() ?? 0 }))
    .filter(({ key, modified }) =>
      key && !keep.has(key) &&
      // A replaced image goes at once; an unsaved upload once it's abandoned
      (replaced.has(key) || modified < cutoff));
  if (!stale.length) return;

  await s3.send(new DeleteObjectsCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Delete: { Objects: stale.map(({ key }) => ({ Key: key })), Quiet: true },
  }));
}

/** The feed, search, hero and watch pages cache the uploader's avatar. */
async function invalidateAvatarCaches(userId: string): Promise<void> {
  const videos = await Video.find({ user_id: userId }, { _id: 1 }).lean().exec();
  await Promise.all([
    redisService.delPattern('ss:feed:*'),
    redisService.delPattern('ss:search:*'),
    redisService.del(CK.topLiked()),
    redisService.del(...videos.map(v => CK.singleVideo(String(v._id)))),
  ]);
}
