/**
 * Crop math and canvas helpers for the profile image editor.
 *
 * A crop is described in OUTPUT pixels: the frame is the finished image
 * (e.g. 512 × 512 for an avatar) and `x`/`y` move the image's centre away
 * from the frame's centre. The editor only scales that for display, so a
 * resized dialog never changes what gets saved.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface CropState {
  /** 1 = the image just covers the frame */
  zoom: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** Largest side kept after decoding; bigger photos only cost memory. */
export const MAX_SOURCE_SIDE = 4096;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Scale at which the image just covers the frame */
export function coverScale(frame: Size, image: Size): number {
  return Math.max(frame.width / image.width, frame.height / image.height);
}

/** Keeps the zoom in range and the frame fully covered (no empty edges). */
export function clampCrop(state: CropState, frame: Size, image: Size): CropState {
  const zoom = clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
  const scale = coverScale(frame, image) * zoom;
  const maxX = Math.max(0, (image.width * scale - frame.width) / 2);
  const maxY = Math.max(0, (image.height * scale - frame.height) / 2);
  return { zoom, x: clamp(state.x, -maxX, maxX), y: clamp(state.y, -maxY, maxY) };
}

/** The part of the image inside the frame, in image pixels */
export function sourceRect(state: CropState, frame: Size, image: Size): Rect {
  const scale = coverScale(frame, image) * state.zoom;
  const width = Math.min(image.width, frame.width / scale);
  const height = Math.min(image.height, frame.height / scale);
  const x = image.width / 2 - (frame.width / 2 + state.x) / scale;
  const y = image.height / 2 - (frame.height / 2 + state.y) / scale;
  return {
    x: clamp(x, 0, image.width - width),
    y: clamp(y, 0, image.height - height),
    width,
    height,
  };
}

/**
 * Zooms while keeping the image point under `anchor` (frame pixels, measured
 * from the frame's centre) in place, as pinch and wheel zoom should.
 */
export function zoomAround(
  state: CropState, zoom: number, anchor: { x: number; y: number }, frame: Size, image: Size,
): CropState {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const ratio = next / state.zoom;
  return clampCrop({
    zoom: next,
    x: anchor.x - (anchor.x - state.x) * ratio,
    y: anchor.y - (anchor.y - state.y) * ratio,
  }, frame, image);
}

/** The centred part of `rect` with the given aspect ratio (width / height) */
export function centerCrop(rect: Rect, aspect: number): Rect {
  if (rect.width / rect.height > aspect) {
    const width = rect.height * aspect;
    return { x: rect.x + (rect.width - width) / 2, y: rect.y, width, height: rect.height };
  }
  const height = rect.width / aspect;
  return { x: rect.x, y: rect.y + (rect.height - height) / 2, width: rect.width, height };
}

// ── Canvas helpers (browser only) ─────────────────────────────────────────────

export interface DecodedImage {
  /** Upright, at most MAX_SOURCE_SIDE on its longer side */
  canvas: HTMLCanvasElement;
  /** Size of the original file's pixels, for the low-resolution warning */
  natural: Size;
}

/** Decodes an image file upright (EXIF orientation applied). */
export async function decodeImageFile(file: Blob): Promise<DecodedImage> {
  const source = await decode(file);
  const natural = { width: source.width, height: source.height };
  if (!natural.width || !natural.height) throw new Error('empty image');

  const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(natural.width, natural.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(natural.width * scale);
  canvas.height = Math.round(natural.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();
  return { canvas, natural };
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall back to <img>, which also applies EXIF orientation */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A copy of `source` turned 90° clockwise */
export function rotateClockwise(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.height;
  canvas.height = source.width;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** Draws `rect` of `source` to fill `target` completely. */
export function drawRect(target: HTMLCanvasElement, source: CanvasImageSource, rect: Rect, background?: string): void {
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingQuality = 'high';
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, target.width, target.height);
  } else {
    ctx.clearRect(0, 0, target.width, target.height);
  }
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, target.width, target.height);
}

/**
 * Renders the finished crop and encodes it: WebP where the browser can
 * encode it (keeps transparency), otherwise JPEG on white. Steps the
 * quality down until the file fits `maxBytes`.
 */
export async function exportCrop(
  source: HTMLCanvasElement, state: CropState, output: Size, maxBytes: number,
): Promise<Blob> {
  const rect = sourceRect(state, output, source);
  const canvas = document.createElement('canvas');
  canvas.width = output.width;
  canvas.height = output.height;
  drawRect(canvas, source, rect);

  const qualities = [0.9, 0.82, 0.72, 0.6];
  if (await canEncodeWebp()) {
    for (const quality of qualities) {
      const blob = await toBlob(canvas, 'image/webp', quality);
      if (blob && blob.type === 'image/webp' && blob.size <= maxBytes) return blob;
    }
  }

  // JPEG has no transparency: put transparent pixels on white.
  drawRect(canvas, source, rect, '#ffffff');
  for (const quality of qualities) {
    const blob = await toBlob(canvas, 'image/jpeg', quality);
    if (blob && blob.size <= maxBytes) return blob;
  }
  throw new Error('too large');
}

let webpSupport: Promise<boolean> | null = null;

/** Some browsers (Safari) silently return PNG when asked for WebP. */
function canEncodeWebp(): Promise<boolean> {
  webpSupport ??= (async () => {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const blob = await toBlob(probe, 'image/webp', 0.8);
    return blob?.type === 'image/webp';
  })();
  return webpSupport;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}
