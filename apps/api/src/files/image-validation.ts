import type { AllowedImageMimeType } from '@inkflow/shared';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ValidatedImage {
  mimeType: AllowedImageMimeType;
  width: number | null;
  height: number | null;
}

export class ImageValidationError extends Error {
  constructor(
    message: string,
    /** `type` → unsupported/mismatched content type (415); `content` → malformed or unsafe (400/415). */
    public readonly kind: 'type' | 'content',
  ) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Largest accepted width/height (sanity bound against decompression-bomb style metadata). */
export const MAX_IMAGE_DIMENSION = 50_000;

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.subarray(start, end).toString('latin1');
}

// ───────────────────────────── type detection ─────────────────────────────

function looksLikeSvg(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  const head = buf.subarray(0, Math.min(buf.length, 4096));
  if (head.includes(0)) return false; // binary data
  let text = head.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.trimStart();
  // Skip XML declaration, comments, processing instructions and a DOCTYPE before the root element.
  for (let guard = 0; guard < 50; guard++) {
    if (text.startsWith('<?')) {
      const end = text.indexOf('?>');
      if (end < 0) return false;
      text = text.slice(end + 2).trimStart();
    } else if (text.startsWith('<!--')) {
      const end = text.indexOf('-->');
      if (end < 0) return false;
      text = text.slice(end + 3).trimStart();
    } else if (/^<!doctype/i.test(text)) {
      const end = text.indexOf('>');
      if (end < 0) return false;
      text = text.slice(end + 1).trimStart();
    } else {
      break;
    }
  }
  return /^<(?:[a-z][\w.-]*:)?svg[\s>/]/i.test(text);
}

/** Detects the image type from its magic bytes (never from the file name or declared type). */
export function detectImageType(buf: Buffer): AllowedImageMimeType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6) {
    const sig = ascii(buf, 0, 6);
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif';
  }
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP')
    return 'image/webp';
  if (looksLikeSvg(buf)) return 'image/svg+xml';
  return null;
}

// ───────────────────────────── dimensions ─────────────────────────────

export function pngDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24 || ascii(buf, 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function jpegDimensions(buf: Buffer): ImageDimensions | null {
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null;
    let marker = buf[offset + 1]!;
    // Skip fill bytes.
    while (marker === 0xff && offset + 2 < buf.length) {
      offset++;
      marker = buf[offset + 1]!;
    }
    offset += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before a frame header
    if (offset + 2 > buf.length) return null;
    const length = buf.readUInt16BE(offset);
    if (length < 2) return null;
    if (JPEG_SOF.has(marker)) {
      if (offset + 7 > buf.length) return null;
      return { height: buf.readUInt16BE(offset + 3), width: buf.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

export function gifDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

export function webpDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 30) return null;
  const chunk = ascii(buf, 12, 16);
  if (chunk === 'VP8 ') {
    // Frame tag (3 bytes) then start code 9d 01 2a.
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const b0 = buf[21]!;
    const b1 = buf[22]!;
    const b2 = buf[23]!;
    const b3 = buf[24]!;
    return {
      width: 1 + (b0 | ((b1 & 0x3f) << 8)),
      height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
    };
  }
  if (chunk === 'VP8X') {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  return null;
}

function parseLength(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*(px|pt|mm|cm|in)?\s*$/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  const factor: Record<string, number> = { px: 1, pt: 4 / 3, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  const px = n * (m[2] ? factor[m[2].toLowerCase()]! : 1);
  return Number.isFinite(px) && px > 0 ? Math.round(px) : null;
}

function rootSvgTag(text: string): string | null {
  const m = /<(?:[a-z][\w.-]*:)?svg\b([^>]*)>/i.exec(text);
  return m ? m[1]! : null;
}

function attr(tagAttrs: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(tagAttrs);
  return m ? (m[1] ?? m[2]) : undefined;
}

export function svgDimensions(text: string): ImageDimensions | null {
  const tag = rootSvgTag(text);
  if (tag === null) return null;
  const width = parseLength(attr(tag, 'width'));
  const height = parseLength(attr(tag, 'height'));
  if (width && height) return { width, height };
  const viewBox = attr(tag, 'viewBox');
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2]! > 0 && parts[3]! > 0) {
      const vw = parts[2]!;
      const vh = parts[3]!;
      if (width) return { width, height: Math.round((width * vh) / vw) };
      if (height) return { width: Math.round((height * vw) / vh), height };
      return { width: Math.round(vw), height: Math.round(vh) };
    }
  }
  return null;
}

// ───────────────────────────── SVG safety ─────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  lpar: '(',
  rpar: ')',
  sol: '/',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decodes character references and drops whitespace/control characters (defeats `java&#x09;script:`). */
function normalizeForUrlChecks(text: string): string {
  return (
    text
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
        String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)),
      )
      .replace(/&#([0-9]+);?/g, (_, dec: string) =>
        String.fromCodePoint(Math.min(parseInt(dec, 10), 0x10ffff)),
      )
      .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
      // eslint-disable-next-line no-control-regex
      .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, '')
      .toLowerCase()
  );
}

/**
 * Returns the reason an SVG is unsafe to serve, or null. Rejects scripts, event handlers,
 * `javascript:`/`vbscript:`/`data:text/html` URLs, `<foreignObject>`, embedded documents, external
 * `<use>` references, entity declarations and non-XML processing instructions.
 */
export function svgSafetyIssue(text: string): string | null {
  const lower = text.toLowerCase();
  if (/<\s*(?:[a-z][\w.-]*:)?script[\s>/]/i.test(text) || lower.includes('<script'))
    return 'SVG must not contain scripts';
  if (/<\s*(?:[a-z][\w.-]*:)?foreignobject[\s>/]/i.test(text))
    return 'SVG must not contain <foreignObject>';
  if (/<\s*(?:[a-z][\w.-]*:)?(?:iframe|embed|object|handler|listener)[\s>/]/i.test(text)) {
    return 'SVG must not embed other documents';
  }
  if (/<!entity/i.test(text)) return 'SVG must not declare entities';
  if (/<!doctype[^>]*\[/i.test(text)) return 'SVG must not contain an internal DTD subset';
  if (/<\?(?!xml\s)/i.test(text)) return 'SVG must not contain processing instructions';
  // Event handler attributes (onload=, onclick=, …), including namespaced ones.
  if (/[\s"'/](?:[a-z][\w.-]*:)?on[a-z]+\s*=/i.test(text))
    return 'SVG must not contain event handler attributes';
  const normalized = normalizeForUrlChecks(text);
  if (normalized.includes('javascript:')) return 'SVG must not contain javascript: URLs';
  if (normalized.includes('vbscript:')) return 'SVG must not contain vbscript: URLs';
  if (normalized.includes('data:text/html') || normalized.includes('data:application/xhtml')) {
    return 'SVG must not contain HTML data URLs';
  }
  // <use> may only reference fragments of the same document.
  const useRe = /<\s*(?:[a-z][\w.-]*:)?use\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = useRe.exec(text))) {
    const attrs = m[1]!;
    const hrefRe = /(?:^|\s)(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let h: RegExpExecArray | null;
    while ((h = hrefRe.exec(attrs))) {
      const href = (h[1] ?? h[2] ?? '').trim();
      if (!href.startsWith('#'))
        return 'SVG <use> must only reference elements of the same document';
    }
  }
  return null;
}

// ───────────────────────────── entry point ─────────────────────────────

/**
 * Validates an uploaded image: the magic bytes decide the type, which must be allowed and match
 * the declared type (when a specific one was declared); dimensions are parsed from the headers.
 */
export function validateImage(
  buf: Buffer,
  declaredMime: string | null | undefined,
  allowed: readonly AllowedImageMimeType[],
): ValidatedImage {
  if (buf.length === 0) throw new ImageValidationError('The file is empty', 'content');
  const detected = detectImageType(buf);
  if (!detected)
    throw new ImageValidationError(
      'Unsupported file type; upload a PNG, JPEG, WebP, GIF or SVG image',
      'type',
    );
  if (!allowed.includes(detected))
    throw new ImageValidationError(`Images of type ${detected} are not accepted here`, 'type');
  const declared = declaredMime?.split(';')[0]?.trim().toLowerCase();
  const generic =
    !declared || declared === 'application/octet-stream' || declared === 'binary/octet-stream';
  const normalizedDeclared =
    declared === 'image/jpg' || declared === 'image/pjpeg' ? 'image/jpeg' : declared;
  if (!generic && normalizedDeclared !== detected) {
    throw new ImageValidationError(
      `File content (${detected}) does not match its declared type (${declared})`,
      'type',
    );
  }

  let dims: ImageDimensions | null;
  switch (detected) {
    case 'image/png':
      dims = pngDimensions(buf);
      break;
    case 'image/jpeg':
      dims = jpegDimensions(buf);
      break;
    case 'image/gif':
      dims = gifDimensions(buf);
      break;
    case 'image/webp':
      dims = webpDimensions(buf);
      break;
    case 'image/svg+xml': {
      const text = buf.toString('utf8');
      if (text.includes('�'))
        throw new ImageValidationError('SVG must be valid UTF-8 text', 'content');
      const issue = svgSafetyIssue(text);
      if (issue) throw new ImageValidationError(issue, 'content');
      dims = svgDimensions(text);
      break;
    }
  }
  if (detected !== 'image/svg+xml') {
    if (!dims || dims.width <= 0 || dims.height <= 0) {
      throw new ImageValidationError('The image header is corrupt or incomplete', 'content');
    }
  }
  if (dims && (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION)) {
    throw new ImageValidationError(
      `Images may be at most ${MAX_IMAGE_DIMENSION}px wide and high`,
      'content',
    );
  }
  return { mimeType: detected, width: dims?.width ?? null, height: dims?.height ?? null };
}
