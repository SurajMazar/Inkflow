import { describe, expect, it } from 'vitest';
import {
  detectImageType,
  gifDimensions,
  ImageValidationError,
  jpegDimensions,
  pngDimensions,
  svgDimensions,
  svgSafetyIssue,
  validateImage,
  webpDimensions,
} from './image-validation';

const ALL = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'] as const;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function jpeg(width: number, height: number): Buffer {
  const app0 = [
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00,
  ];
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    1,
    0x11,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

function gif(width: number, height: number): Buffer {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

function riff(chunk: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(payload.length + 12, 4);
  head.write('WEBP', 8, 'latin1');
  head.write(chunk, 12, 'latin1');
  head.writeUInt32LE(payload.length, 16);
  return Buffer.concat([head, payload, Buffer.alloc(16)]);
}

function webpVp8x(width: number, height: number): Buffer {
  const p = Buffer.alloc(10);
  p.writeUIntLE(width - 1, 4, 3);
  p.writeUIntLE(height - 1, 7, 3);
  return riff('VP8X', p);
}

function webpVp8l(width: number, height: number): Buffer {
  const p = Buffer.alloc(5);
  p[0] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  p.writeUInt32LE(bits >>> 0, 1);
  return riff('VP8L', p);
}

function webpVp8(width: number, height: number): Buffer {
  const p = Buffer.alloc(10);
  p[3] = 0x9d;
  p[4] = 0x01;
  p[5] = 0x2a;
  p.writeUInt16LE(width, 6);
  p.writeUInt16LE(height, 8);
  return riff('VP8 ', p);
}

describe('image type detection (magic bytes)', () => {
  it('detects every supported format', () => {
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(jpeg(2, 2))).toBe('image/jpeg');
    expect(detectImageType(gif(1, 1))).toBe('image/gif');
    expect(detectImageType(webpVp8x(4, 4))).toBe('image/webp');
    expect(
      detectImageType(
        Buffer.from('﻿<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg"/>'),
      ),
    ).toBe('image/svg+xml');
    expect(
      detectImageType(
        Buffer.from('<!DOCTYPE svg><svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>'),
      ),
    ).toBe('image/svg+xml');
  });

  it('rejects other content', () => {
    expect(detectImageType(Buffer.from('hello world'))).toBeNull();
    expect(detectImageType(Buffer.from('<html><svg></svg></html>'))).toBeNull();
    expect(detectImageType(Buffer.from([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
  });
});

describe('dimension parsing', () => {
  it('reads PNG, JPEG, GIF and WebP headers', () => {
    expect(pngDimensions(PNG)).toEqual({ width: 1, height: 1 });
    expect(jpegDimensions(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(gifDimensions(gif(300, 200))).toEqual({ width: 300, height: 200 });
    expect(webpDimensions(webpVp8x(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(webpDimensions(webpVp8l(10, 20))).toEqual({ width: 10, height: 20 });
    expect(webpDimensions(webpVp8(33, 44))).toEqual({ width: 33, height: 44 });
  });

  it('reads SVG width/height/viewBox', () => {
    expect(svgDimensions('<svg width="120" height="80px"></svg>')).toEqual({
      width: 120,
      height: 80,
    });
    expect(svgDimensions('<svg viewBox="0 0 300 150"></svg>')).toEqual({ width: 300, height: 150 });
    expect(svgDimensions('<svg width="600" viewBox="0,0,300,150"></svg>')).toEqual({
      width: 600,
      height: 300,
    });
    expect(svgDimensions('<svg width="100%"></svg>')).toBeNull();
  });
});

describe('SVG safety', () => {
  it('accepts plain drawings', () => {
    expect(
      svgSafetyIssue(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="p"/></defs><use href="#p"/><text>on time</text></svg>',
      ),
    ).toBeNull();
  });

  it.each([
    ['<svg><script>alert(1)</script></svg>', 'scripts'],
    ['<svg><svg:script>x</svg:script></svg>', 'scripts'],
    ['<svg onload="alert(1)"></svg>', 'event handler'],
    ['<svg><rect ONCLICK = "x"/></svg>', 'event handler'],
    ['<svg><a href="javascript:alert(1)"/></svg>', 'javascript:'],
    ['<svg><a href="java&#x0A;script:alert(1)"/></svg>', 'javascript:'],
    ['<svg><a href="&#106;avascript&colon;x"/></svg>', 'javascript:'],
    ['<svg><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>', 'HTML data URLs'],
    ['<svg><foreignObject/></svg>', 'foreignObject'],
    ['<svg><use xlink:href="http://evil/x.svg#a"/></svg>', '<use>'],
    ['<!DOCTYPE svg [<!ENTITY a "b">]><svg/>', 'entities'],
    ['<?xml-stylesheet href="http://evil/x.css"?><svg/>', 'processing instructions'],
    ['<svg><iframe src="x"/></svg>', 'embed'],
  ])('rejects %s', (svg, reason) => {
    expect(svgSafetyIssue(svg)).toContain(reason);
  });
});

describe('validateImage', () => {
  it('returns type and dimensions', () => {
    expect(validateImage(PNG, 'image/png', ALL)).toEqual({
      mimeType: 'image/png',
      width: 1,
      height: 1,
    });
    expect(validateImage(jpeg(8, 4), 'image/jpg', ALL)).toEqual({
      mimeType: 'image/jpeg',
      width: 8,
      height: 4,
    });
    expect(validateImage(PNG, 'application/octet-stream', ALL).mimeType).toBe('image/png');
  });

  it('rejects mismatches, disallowed types, corrupt headers and unsafe SVGs', () => {
    expect(() => validateImage(PNG, 'image/gif', ALL)).toThrow(ImageValidationError);
    expect(() => validateImage(Buffer.from('fake'), 'image/png', ALL)).toThrow(/Unsupported/);
    expect(() => validateImage(gif(1, 1), 'image/gif', ['image/png', 'image/webp'])).toThrow(
      /not accepted/,
    );
    expect(() => validateImage(PNG.subarray(0, 12), 'image/png', ALL)).toThrow(/corrupt/);
    expect(() => validateImage(Buffer.from('<svg onload="x"/>'), 'image/svg+xml', ALL)).toThrow(
      /event handler/,
    );
    expect(() => validateImage(Buffer.alloc(0), 'image/png', ALL)).toThrow(/empty/);
    expect(() => validateImage(gif(60_000, 1), 'image/gif', ALL)).toThrow(/at most/);
  });
});
