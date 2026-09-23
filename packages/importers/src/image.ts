/**
 * Image file reading without DOM APIs: the format is sniffed from magic bytes, dimensions are
 * parsed from the file headers and the data URL is built with a local base64 encoder, so the
 * same code runs in browsers, workers and Node.
 */
import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES, type AllowedImageMimeType } from '@inkflow/shared';
import { looksLikeSvg } from './detect';
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from './limits';
import { bytesToBase64, sanitizeSvg, svgToDataUrl } from './svg-sanitize';
import { findSvgRoot, getSvgIntrinsicSize, parseXml } from './svg-tokenizer';

export interface ImageFileData {
  dataUrl: string;
  mimeType: AllowedImageMimeType;
  width: number;
  height: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWithBytes(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) if (bytes[offset + i] !== signature[i]) return false;
  return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + ((b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!);

/** Decodes the leading bytes of a (possibly binary) file as UTF-8 text. */
function decodeHead(bytes: Uint8Array, maxBytes: number): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, maxBytes)));
}

/** Identifies an allowed image format from its magic bytes (SVG from its leading markup). */
export function sniffImageMime(bytes: Uint8Array): AllowedImageMimeType | null {
  if (startsWithBytes(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  const gif = ascii(bytes, 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (looksLikeSvg(decodeHead(bytes, 64 * 1024))) return 'image/svg+xml';
  return null;
}

function pngDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24 || !startsWithBytes(b, PNG_SIGNATURE) || ascii(b, 12, 4) !== 'IHDR') return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function gifDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 10) return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

/** Start-of-frame markers carrying the image size (baseline, progressive, lossless, arithmetic). */
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegDimensions(b: Uint8Array): ImageDimensions | null {
  if (!startsWithBytes(b, [0xff, 0xd8])) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) return null;
    const marker = b[i]!;
    i++;
    // Standalone markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (i + 2 > b.length) return null;
    const length = u16be(b, i);
    if (length < 2) return null;
    if (JPEG_SOF.has(marker)) {
      if (i + 7 > b.length) return null;
      return { width: u16be(b, i + 5), height: u16be(b, i + 3) };
    }
    i += length;
  }
  return null;
}

function webpDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8X') {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  if (chunk === 'VP8 ') {
    // Frame tag (3 bytes) then the start code 9D 01 2A.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const b0 = b[21]!;
    const b1 = b[22]!;
    const b2 = b[23]!;
    const b3 = b[24]!;
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

function svgDimensions(b: Uint8Array): ImageDimensions | null {
  const root = findSvgRoot(parseXml(new TextDecoder('utf-8', { fatal: false }).decode(b).replace(/^\uFEFF/, '')));
  return root ? getSvgIntrinsicSize(root) : null;
}

/** Reads the pixel size of an image from its header bytes; null when it cannot be determined. */
export function readImageDimensions(bytes: Uint8Array, mime: string): ImageDimensions | null {
  switch (mime) {
    case 'image/png':
      return pngDimensions(bytes);
    case 'image/gif':
      return gifDimensions(bytes);
    case 'image/jpeg':
      return jpegDimensions(bytes);
    case 'image/webp':
      return webpDimensions(bytes);
    case 'image/svg+xml':
      return svgDimensions(bytes);
    default:
      return null;
  }
}

export function isAllowedImageMime(mime: string): mime is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Reads an image blob into a data URL plus its natural size. The format is determined from the
 * content (a disagreeing `blob.type` is ignored); SVG is sanitized before it is encoded.
 */
export async function readImageFile(blob: Blob): Promise<ImageFileData> {
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Image is too large (max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB)`);
  }
  if (blob.size === 0) throw new Error('Image file is empty');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Image is too large');
  const mimeType = sniffImageMime(bytes);
  if (!mimeType) throw new Error('Unsupported or unrecognized image format');

  if (mimeType === 'image/svg+xml') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const clean = sanitizeSvg(text);
    const root = findSvgRoot(parseXml(clean));
    const size = root ? getSvgIntrinsicSize(root) : { width: 300, height: 150 };
    const width = Math.min(MAX_IMAGE_DIMENSION, Math.max(1, size.width));
    const height = Math.min(MAX_IMAGE_DIMENSION, Math.max(1, size.height));
    return { dataUrl: svgToDataUrl(clean), mimeType, width, height };
  }

  const dims = readImageDimensions(bytes, mimeType);
  if (!dims || dims.width <= 0 || dims.height <= 0) throw new Error('Could not read the image dimensions; the file may be corrupt');
  if (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION || dims.width * dims.height > MAX_IMAGE_PIXELS) {
    throw new Error('Image dimensions are too large');
  }
  return { dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`, mimeType, width: dims.width, height: dims.height };
}
