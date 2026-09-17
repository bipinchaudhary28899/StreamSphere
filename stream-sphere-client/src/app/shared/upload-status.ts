// Shared wording for "where is my video up to", used by the floating upload
// cards and by the list on the upload page.

import { UploadJob } from '../services/upload-manager.service';
import { ProcessingVideo } from '../services/upload-status.service';
import { timeLeftLabel } from './format';

/** One thing to report on: an upload from this tab, or a video the backend is working on. */
export interface UploadStatusItem {
  key: string;
  job: UploadJob | null;
  video: ProcessingVideo | null;
  /** The video finished processing and can be watched */
  ready: boolean;
}

/**
 * This tab's uploads (newest first), then videos the backend is still working
 * on that none of those uploads covers — e.g. ones found after a page refresh.
 */
export function buildStatusItems(
  jobs: UploadJob[],
  processing: ProcessingVideo[],
  readyVideos: ProcessingVideo[] = [],
): UploadStatusItem[] {
  const items: UploadStatusItem[] = [];

  for (const job of [...jobs].reverse()) {
    if (job.phase === 'cancelled') continue;
    items.push({ key: job.id, job, video: null, ready: job.phase === 'ready' });
  }

  const claimed = new Set(jobs.map(job => job.videoId).filter(Boolean) as string[]);
  for (const video of [...readyVideos, ...processing]) {
    if (claimed.has(video.id) || items.some(item => item.video?.id === video.id)) continue;
    items.push({
      key: `video-${video.id}`,
      job: null,
      video,
      ready: readyVideos.some(v => v.id === video.id),
    });
  }

  return items;
}

export function statusTitle(item: UploadStatusItem): string {
  return item.job?.title ?? item.video?.title ?? '';
}

export function statusTone(item: UploadStatusItem): 'busy' | 'ready' | 'failed' {
  if (item.job?.phase === 'failed') return 'failed';
  if (item.job?.phase === 'ready' || item.ready) return 'ready';
  return 'busy';
}

export function statusLabel(item: UploadStatusItem): string {
  switch (item.job?.phase) {
    case 'queued':     return 'Waiting to upload';
    case 'uploading':  return `Uploading · ${item.job.progress}%`;
    case 'saving':     return 'Finishing upload…';
    case 'processing': return 'Uploaded · processing';
    case 'ready':      return 'Ready to watch';
    case 'failed':     return 'Upload failed';
  }
  return item.ready ? 'Ready to watch' : 'Processing';
}

export function statusDetail(item: UploadStatusItem): string {
  const job = item.job;
  switch (job?.phase) {
    case 'queued':
      return 'Starts when the video ahead of it finishes';
    case 'uploading':
      return timeLeftLabel(job.file.size - job.uploadedBytes, job.bytesPerSecond)
        || 'Keep this tab open until it finishes';
    case 'processing':
      return 'It will appear in the feed when it’s ready';
    case 'failed':
      return 'Open the upload to try again';
    case 'saving':
    case 'ready':
      return '';
  }
  return item.ready ? '' : 'It will appear in the feed when it’s ready';
}

/** 0–100 while sending, null when there is no bar to show. */
export function statusProgress(item: UploadStatusItem): number | null {
  return item.job?.phase === 'uploading' ? item.job.progress : null;
}

export function statusIndeterminate(item: UploadStatusItem): boolean {
  return item.job?.phase === 'saving';
}

/** Set when the item can be watched now. */
export function statusWatchId(item: UploadStatusItem): string | null {
  if (item.job) return item.job.phase === 'ready' ? item.job.videoId : null;
  return item.ready ? item.video?.id ?? null : null;
}
