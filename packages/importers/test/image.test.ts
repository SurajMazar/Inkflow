import { MAX_UPLOAD_BYTES } from '@inkflow/shared';
import { describe, expect, it } from 'vitest';
import { readImageDimensions, readImageFile, sniffImageMime } from '../src/image';
import { base64ToBytes, bytesToBase64 } from '../src/svg-sanitize';

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function makePng(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...ascii('IHDR'),
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    ...be32(0),
    ...be32(0),
    ...ascii('IEND'),
    ...be32(0),
  ]);
}

function makeGif(width: number, height: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...ascii('GIF89a'), ...le16(width), ...le16(height), 0, 0, 0, 0x3b]);
}

function makeJpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [
    0xff,
    0xc0,
    0x00,
    0x11,
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

function riff(chunk: string, payload: number[]): Uint8Array<ArrayBuffer> {
  const body = [...ascii('WEBP'), ...ascii(chunk), ...le32(payload.length), ...payload];
  while (body.length < 30) body.push(0);
  return new Uint8Array([...ascii('RIFF'), ...le32(body.length), ...body]);
}

const makeWebpVp8x = (w: number, h: number) =>
  riff('VP8X', [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
const makeWebpVp8 = (w: number, h: number) =>
  riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0]);
function makeWebpVp8l(w: number, h: number): Uint8Array<ArrayBuffer> {
  const bits = ((w - 1) | ((h - 1) << 14)) >>> 0;
  return riff('VP8L', [
    0x2f,
    bits & 0xff,
    (bits >>> 8) & 0xff,
    (bits >>> 16) & 0xff,
    (bits >>> 24) & 0xff,
    0,
    0,
    0,
  ]);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('sniffImageMime', () => {
  it('identifies raster formats by magic bytes', () => {
    expect(sniffImageMime(makePng(1, 1))).toBe('image/png');
    expect(sniffImageMime(makeJpeg(1, 1))).toBe('image/jpeg');
    expect(sniffImageMime(makeGif(1, 1))).toBe('image/gif');
    expect(sniffImageMime(new Uint8Array([...ascii('GIF87a'), 1, 0, 1, 0]))).toBe('image/gif');
    expect(sniffImageMime(makeWebpVp8x(2, 2))).toBe('image/webp');
  });

  it('identifies SVG after BOM, prolog and comments', () => {
    expect(sniffImageMime(utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
    expect(
      sniffImageMime(utf8('\uFEFF  <?xml version="1.0"?>\n<!-- hi -->\n<svg width="1"></svg>')),
    ).toBe('image/svg+xml');
    expect(
      sniffImageMime(utf8('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "b">]><svg/>')),
    ).toBe('image/svg+xml');
  });

  it('rejects unknown content', () => {
    expect(sniffImageMime(new Uint8Array([]))).toBeNull();
    expect(sniffImageMime(utf8('<html><svg></svg></html>'))).toBeNull();
    expect(sniffImageMime(utf8('BM this is a bitmap'))).toBeNull();
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('readImageDimensions', () => {
  it('parses PNG, GIF and JPEG headers', () => {
    expect(readImageDimensions(makePng(640, 480), 'image/png')).toEqual({
      width: 640,
      height: 480,
    });
    expect(readImageDimensions(makeGif(33, 44), 'image/gif')).toEqual({ width: 33, height: 44 });
    expect(readImageDimensions(makeJpeg(1920, 1080), 'image/jpeg')).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('parses the three WebP variants', () => {
    expect(readImageDimensions(makeWebpVp8x(3000, 2000), 'image/webp')).toEqual({
      width: 3000,
      height: 2000,
    });
    expect(readImageDimensions(makeWebpVp8(320, 240), 'image/webp')).toEqual({
      width: 320,
      height: 240,
    });
    expect(readImageDimensions(makeWebpVp8l(1000, 16383), 'image/webp')).toEqual({
      width: 1000,
      height: 16383,
    });
  });

  it('parses SVG sizes from width/height or viewBox', () => {
    const dims = (s: string) => readImageDimensions(utf8(s), 'image/svg+xml');
    expect(dims('<svg width="120" height="80px"/>')).toEqual({ width: 120, height: 80 });
    expect(dims('<svg viewBox="0 0 400 200"/>')).toEqual({ width: 400, height: 200 });
    expect(dims('<svg width="100" viewBox="0 0 400 200"/>')).toEqual({ width: 100, height: 50 });
    expect(dims('<svg width="100%" height="50%"/>')).toEqual({ width: 300, height: 150 });
    expect(dims('<svg/>')).toEqual({ width: 300, height: 150 });
  });

  it('returns null for truncated or corrupt headers', () => {
    expect(readImageDimensions(makePng(1, 1).subarray(0, 20), 'image/png')).toBeNull();
    expect(
      readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]), 'image/jpeg'),
    ).toBeNull();
    expect(readImageDimensions(new Uint8Array([1, 2, 3]), 'image/bmp')).toBeNull();
  });
});

describe('base64 helpers', () => {
  it('match Node Buffer encoding for all padding cases', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 255, 256, 12_289]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 0xff);
      const encoded = bytesToBase64(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
      expect([...base64ToBytes(encoded)]).toEqual([...bytes]);
    }
    expect(() => base64ToBytes('ab$d')).toThrow();
  });
});

describe('readImageFile', () => {
  it('reads a PNG blob and uses the sniffed type', async () => {
    const png = makePng(64, 32);
    const result = await readImageFile(new Blob([png], { type: 'image/jpeg' }));
    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(64);
    expect(result.height).toBe(32);
    expect(result.dataUrl).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
  });

  it('sanitizes SVG blobs', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20" onload="alert(1)"><script>alert(2)</script><rect width="5" height="5"/></svg>';
    const result = await readImageFile(new Blob([svg], { type: 'image/svg+xml' }));
    expect(result.mimeType).toBe('image/svg+xml');
    expect(result).toMatchObject({ width: 10, height: 20 });
    const decoded = Buffer.from(
      result.dataUrl.replace('data:image/svg+xml;base64,', ''),
      'base64',
    ).toString('utf8');
    expect(decoded).toContain('<rect');
    expect(decoded).not.toMatch(/script|onload|alert/i);
  });

  it('rejects files over the upload limit without reading them', async () => {
    let read = false;
    const blob = {
      size: MAX_UPLOAD_BYTES + 1,
      type: 'image/png',
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as unknown as Blob;
    await expect(readImageFile(blob)).rejects.toThrow(/too large/);
    expect(read).toBe(false);
  });

  it('rejects unknown formats, empty files and corrupt headers', async () => {
    await expect(readImageFile(new Blob(['hello world'], { type: 'image/png' }))).rejects.toThrow(
      /Unsupported/,
    );
    await expect(readImageFile(new Blob([]))).rejects.toThrow(/empty/);
    await expect(
      readImageFile(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])])),
    ).rejects.toThrow(/dimensions/);
  });

  it('rejects absurd raster dimensions', async () => {
    await expect(readImageFile(new Blob([makePng(100_000, 100_000)]))).rejects.toThrow(/too large/);
  });
});
