/**
 * Allow-list based SVG sanitizer. Markup is tokenized with the local XML tokenizer and rebuilt
 * from scratch, so only known-safe elements, attributes and CSS declarations survive. Scripts,
 * event handlers, external references, `<style>` sheets, foreign content and DTDs are removed.
 */
import { MAX_SVG_CHARS } from './limits';
import {
  escapeXmlAttribute,
  escapeXmlText,
  findSvgRoot,
  localName,
  parseXml,
  type XmlAttribute,
  type XmlElement,
} from './svg-tokenizer';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const ALLOWED_ELEMENTS = [
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'image',
] as const;

/** Lower-cased element name → canonical SVG spelling. */
const ELEMENT_LOOKUP = new Map<string, string>(ALLOWED_ELEMENTS.map((name) => [name.toLowerCase(), name]));

/** Elements whose character data is kept (and escaped) in the output. */
const TEXT_CONTENT_ELEMENTS = new Set(['text', 'tspan', 'title', 'desc']);

const ALLOWED_ATTRIBUTES = [
  'id',
  'class',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'd',
  'points',
  'transform',
  'viewBox',
  'preserveAspectRatio',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'dx',
  'dy',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'fx',
  'fy',
  'fr',
  'clip-path',
  'clip-rule',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
  'orient',
  'markerUnits',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'visibility',
  'display',
  'version',
  'href',
  'xlink:href',
  'style',
] as const;

/** Lower-cased attribute name → canonical SVG spelling. */
const ATTRIBUTE_LOOKUP = new Map<string, string>(ALLOWED_ATTRIBUTES.map((name) => [name.toLowerCase(), name]));

/** CSS properties kept inside `style="…"`. */
const ALLOWED_CSS_PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'stop-color',
  'stop-opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'visibility',
  'display',
]);

/** Elements on which a (local) `href` makes sense. */
const LOCAL_HREF_ELEMENTS = new Set(['use', 'linearGradient', 'radialGradient', 'pattern']);

/** Raster images that may be embedded (no nested SVG documents). */
export const SAFE_SVG_IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

const LOCAL_REF = /^#[A-Za-z_][\w.\-:]*$/;

/** Value as a browser would see it for URL-scheme purposes: no whitespace/control chars, lower-case. */
function normalizeForInspection(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, '').toLowerCase();
}

function hasDangerousScheme(normalized: string): boolean {
  return normalized.includes('javascript:') || normalized.includes('vbscript:') || normalized.includes('livescript:');
}

/** True when every `url(…)` in the value is a local fragment reference. */
function urlsAreLocal(value: string): boolean {
  const lower = value.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf('url(', from);
    if (at < 0) return true;
    const close = value.indexOf(')', at);
    if (close < 0) return false;
    const inner = value
      .slice(at + 4, close)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .trim();
    if (!LOCAL_REF.test(inner)) return false;
    from = close + 1;
  }
}

function isSafeValue(value: string): boolean {
  const normalized = normalizeForInspection(value);
  if (hasDangerousScheme(normalized)) return false;
  if (normalized.includes('data:')) return false;
  if (normalized.includes('expression(') || normalized.includes('@import') || normalized.includes('<')) return false;
  return urlsAreLocal(value);
}

/**
 * Keeps only allow-listed CSS declarations whose values contain no escapes, external URLs,
 * expressions or script schemes. Returns null when nothing survives.
 */
export function sanitizeStyleAttribute(style: string): string | null {
  const withoutComments = style.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '');
  const out: string[] = [];
  for (const declaration of withoutComments.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .replace(/!important\s*$/i, '')
      .trim();
    if (!ALLOWED_CSS_PROPERTIES.has(property) || value === '' || value.length > 1000) continue;
    if (/[\\{}<>]/.test(value) || !isSafeValue(value)) continue;
    out.push(`${property}:${value}`);
  }
  return out.length > 0 ? out.join(';') : null;
}

interface SanitizeContext {
  usesXlink: boolean;
}

function sanitizeAttributes(el: XmlElement, tag: string, ctx: SanitizeContext): XmlAttribute[] | null {
  const out: XmlAttribute[] = [];
  const seen = new Set<string>();
  for (const attr of el.attrs) {
    const lower = attr.name.toLowerCase();
    if (lower.startsWith('on')) continue;
    if (lower === 'xmlns' || lower.startsWith('xmlns:')) continue;
    const canonical = ATTRIBUTE_LOOKUP.get(lower);
    if (!canonical) continue;
    const value = attr.value;
    if (value.length > 2_000_000) continue;
    if (canonical === 'href' || canonical === 'xlink:href') {
      const trimmed = value.trim();
      if (tag === 'image') {
        if (!SAFE_SVG_IMAGE_DATA_URL.test(trimmed.replace(/\s+/g, ''))) continue;
      } else if (!LOCAL_HREF_ELEMENTS.has(tag) || !LOCAL_REF.test(trimmed)) {
        continue;
      }
      // `href` and `xlink:href` are the same reference; keep only one.
      if (seen.has('href')) continue;
      seen.add('href');
      if (canonical === 'xlink:href') ctx.usesXlink = true;
      out.push({ name: canonical, value: tag === 'image' ? trimmed.replace(/\s+/g, '') : trimmed });
      continue;
    }
    if (seen.has(canonical)) continue;
    if (canonical === 'style') {
      if (!isSafeStyleShell(value)) continue;
      const style = sanitizeStyleAttribute(value);
      if (style === null) continue;
      seen.add(canonical);
      out.push({ name: 'style', value: style });
      continue;
    }
    if (!isSafeValue(value)) continue;
    seen.add(canonical);
    out.push({ name: canonical, value });
  }
  if (tag === 'use' || tag === 'image') {
    if (!seen.has('href')) return null;
  }
  return out;
}

/** Style values are further filtered per declaration; only reject blatant script schemes here. */
function isSafeStyleShell(value: string): boolean {
  return !hasDangerousScheme(normalizeForInspection(value));
}

function serializeAttributes(attrs: readonly XmlAttribute[]): string {
  return attrs.map((a) => ` ${a.name}="${escapeXmlAttribute(a.value)}"`).join('');
}

function serializeChildren(el: XmlElement, tag: string, ctx: SanitizeContext): string {
  let inner = '';
  const keepText = TEXT_CONTENT_ELEMENTS.has(tag);
  for (const child of el.children) {
    if (child.kind === 'text') {
      if (keepText) inner += escapeXmlText(child.value);
    } else {
      inner += serializeElement(child, ctx);
    }
  }
  return inner;
}

function canonicalTag(el: XmlElement): string | null {
  if (el.name.includes(':') && !el.name.toLowerCase().startsWith('svg:')) return null;
  return ELEMENT_LOOKUP.get(localName(el.name)) ?? null;
}

function serializeElement(el: XmlElement, ctx: SanitizeContext): string {
  const tag = canonicalTag(el);
  if (!tag) return '';
  const attrs = sanitizeAttributes(el, tag, ctx);
  if (!attrs) return '';
  const inner = serializeChildren(el, tag, ctx);
  const attrText = serializeAttributes(attrs);
  return inner === '' ? `<${tag}${attrText}/>` : `<${tag}${attrText}>${inner}</${tag}>`;
}

// Characters that are not allowed in XML 1.0 documents.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * Returns clean SVG markup with a single `<svg>` root. Throws when the input is too large or
 * has no SVG root element.
 */
export function sanitizeSvg(svgText: string): string {
  if (typeof svgText !== 'string') throw new Error('SVG must be text');
  if (svgText.length > MAX_SVG_CHARS) throw new Error('SVG is too large to import (max 5 MB)');
  const root = findSvgRoot(parseXml(svgText.replace(/^\uFEFF/, '').replace(INVALID_XML_CHARS, '')));
  if (!root || canonicalTag(root) !== 'svg') throw new Error('Not an SVG image: missing <svg> root element');
  const ctx: SanitizeContext = { usesXlink: false };
  const attrs = sanitizeAttributes(root, 'svg', ctx) ?? [];
  const inner = serializeChildren(root, 'svg', ctx);
  const ns = ` xmlns="${SVG_NS}"` + (ctx.usesXlink ? ` xmlns:xlink="${XLINK_NS}"` : '');
  return `<svg${ns}${serializeAttributes(attrs)}>${inner}</svg>`;
}

/** Parses markup, sanitizes it and returns the sanitized `<svg>` element tree. */
export function parseSanitizedSvg(svgText: string): XmlElement {
  const root = findSvgRoot(parseXml(sanitizeSvg(svgText)));
  if (!root) throw new Error('Not an SVG image: missing <svg> root element');
  return root;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) table[BASE64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** Standard (padded) base64 encoding of raw bytes. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 3 * 4096;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(bytes.length, start + CHUNK);
    let out = '';
    for (let i = start; i < end; i += 3) {
      const b0 = bytes[i]!;
      const b1 = i + 1 < end ? bytes[i + 1]! : 0;
      const b2 = i + 2 < end ? bytes[i + 2]! : 0;
      const triple = (b0 << 16) | (b1 << 8) | b2;
      out += BASE64_ALPHABET[(triple >> 18) & 63]! + BASE64_ALPHABET[(triple >> 12) & 63]!;
      out += i + 1 < end ? BASE64_ALPHABET[(triple >> 6) & 63]! : '=';
      out += i + 2 < end ? BASE64_ALPHABET[triple & 63]! : '=';
    }
    parts.push(out);
  }
  return parts.join('');
}

/** Decodes standard base64 (whitespace tolerated). Throws on invalid characters. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[\s]+/g, '').replace(/=+$/, '');
  if (clean.length % 4 === 1) throw new Error('Invalid base64 data');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const v = code < 128 ? BASE64_LOOKUP[code]! : -1;
    if (v < 0) throw new Error('Invalid base64 data');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** `data:image/svg+xml;base64,…` URL of the sanitized SVG (UTF-8 encoded). */
export function svgToDataUrl(svgText: string): string {
  const clean = sanitizeSvg(svgText);
  return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(clean))}`;
}
