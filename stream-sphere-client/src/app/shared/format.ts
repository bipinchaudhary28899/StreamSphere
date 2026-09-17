/** Human-readable byte counts: "739 KB", "21.7 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

/** Clip length as m:ss. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** "About 2 minutes left" from what's still to send and the current rate. */
export function timeLeftLabel(bytesLeft: number, bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '';
  const seconds = bytesLeft / bytesPerSecond;
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 10) return 'A few seconds left';
  const tens = Math.round(seconds / 10) * 10;
  if (tens < 60) return `About ${tens} seconds left`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
}
