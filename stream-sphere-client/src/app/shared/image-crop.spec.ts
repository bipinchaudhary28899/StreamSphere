import { MAX_ZOOM, centerCrop, clampCrop, coverScale, sourceRect, zoomAround } from './image-crop';

describe('image-crop', () => {
  const square = { width: 512, height: 512 };
  const landscape = { width: 2000, height: 1000 };

  describe('coverScale()', () => {
    it('scales the image just enough to cover the frame', () => {
      // Height is the tight side: 512 / 1000
      expect(coverScale(square, landscape)).toBeCloseTo(0.512);
      // A 6:1 banner frame on a 2:1 photo is width-bound: 2400 / 2000
      expect(coverScale({ width: 2400, height: 400 }, landscape)).toBeCloseTo(1.2);
    });
  });

  describe('clampCrop()', () => {
    it('keeps the zoom between the minimum and maximum', () => {
      expect(clampCrop({ zoom: 0.2, x: 0, y: 0 }, square, landscape).zoom).toBe(1);
      expect(clampCrop({ zoom: 99, x: 0, y: 0 }, square, landscape).zoom).toBe(MAX_ZOOM);
    });

    it('never lets an edge of the frame go empty', () => {
      // At zoom 1 the image is 1024 × 512 on a 512 frame: 256 of slack each side
      const crop = clampCrop({ zoom: 1, x: 900, y: 50 }, square, landscape);
      expect(crop.x).toBe(256);
      expect(crop.y).toBe(0);
    });
  });

  describe('sourceRect()', () => {
    it('takes the centre of the image when not moved', () => {
      const rect = sourceRect({ zoom: 1, x: 0, y: 0 }, square, landscape);
      expect(rect).toEqual(jasmine.objectContaining({ x: 500, y: 0, width: 1000, height: 1000 }));
    });

    it('moves the other way to the image: dragging right shows its left side', () => {
      const rect = sourceRect({ zoom: 1, x: 256, y: 0 }, square, landscape);
      expect(rect.x).toBeCloseTo(0);
    });

    it('takes a smaller area when zoomed in', () => {
      const rect = sourceRect({ zoom: 2, x: 0, y: 0 }, square, landscape);
      expect(rect.width).toBeCloseTo(500);
      expect(rect.x).toBeCloseTo(750);
      expect(rect.y).toBeCloseTo(250);
    });
  });

  describe('zoomAround()', () => {
    it('keeps the point under the cursor in place', () => {
      const start = { zoom: 1, x: 0, y: 0 };
      const anchor = { x: 128, y: 64 };
      const before = sourceRect(start, square, landscape);
      const next = zoomAround(start, 2, anchor, square, landscape);
      const after = sourceRect(next, square, landscape);

      // The image pixel under the anchor is the same before and after
      const pixel = (rect: typeof before) => ({
        x: rect.x + ((anchor.x + square.width / 2) / square.width) * rect.width,
        y: rect.y + ((anchor.y + square.height / 2) / square.height) * rect.height,
      });
      expect(pixel(after).x).toBeCloseTo(pixel(before).x);
      expect(pixel(after).y).toBeCloseTo(pixel(before).y);
    });
  });

  describe('centerCrop()', () => {
    const banner = { x: 0, y: 0, width: 2400, height: 400 };

    it('narrows a 6:1 banner to the middle for phones (4:1)', () => {
      expect(centerCrop(banner, 4)).toEqual({ x: 400, y: 0, width: 1600, height: 400 });
    });

    it('shortens it for wide desktops (8:1)', () => {
      expect(centerCrop(banner, 8)).toEqual({ x: 0, y: 50, width: 2400, height: 300 });
    });
  });
});
