/**
 * Minimal, non-validating XML tokenizer and tree builder for untrusted SVG markup. It never
 * resolves external resources and never expands DTD entities (declarations are skipped), so it
 * is immune to entity-expansion and XXE attacks. It runs identically in Node and browsers (no
 * DOMParser).
 */
import { MAX_XML_DEPTH, MAX_XML_TOKENS } from './limits';

export interface XmlAttribute {
  /** Attribute name as written (case preserved). */
  name: string;
  /** Value with the five XML entities and numeric character references decoded. */
  value: string;
}

export type XmlToken =
  | { kind: 'start'; name: string; attrs: XmlAttribute[]; selfClosing: boolean }
  | { kind: 'end'; name: string }
  | { kind: 'text'; value: string }
  | { kind: 'cdata'; value: string }
  | { kind: 'comment'; value: string }
  | { kind: 'pi'; value: string }
  | { kind: 'doctype'; value: string };

export interface XmlElement {
  kind: 'element';
  name: string;
  attrs: XmlAttribute[];
  children: XmlNode[];
}

export interface XmlText {
  kind: 'text';
  /** Decoded character data (CDATA sections are merged in verbatim). */
  value: string;
}

export type XmlNode = XmlElement | XmlText;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function codePointToString(cp: number): string {
  const valid =
    Number.isInteger(cp) &&
    cp > 0 &&
    cp <= 0x10ffff &&
    !(cp >= 0xd800 && cp <= 0xdfff) &&
    cp !== 0xfffe &&
    cp !== 0xffff;
  return valid ? String.fromCodePoint(cp) : '\uFFFD';
}

/**
 * Decodes `&amp; &lt; &gt; &quot; &apos;` and numeric character references. Any other entity
 * reference is left untouched (DTD entities are never expanded).
 */
export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#[xX][0-9a-fA-F]{1,8}|#[0-9]{1,10}|[A-Za-z][A-Za-z0-9]{0,31});?/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return codePointToString(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return codePointToString(parseInt(body.slice(1), 10));
    const named = NAMED_ENTITIES[body];
    return named !== undefined && match.endsWith(';') ? named : match;
  });
}

export function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.-]/;
const WHITESPACE = /[\s]/;

/** Skips a `<!…>` declaration (DOCTYPE with an optional internal subset, ENTITY, ELEMENT…). */
function skipDeclaration(text: string, start: number): number {
  let i = start + 2;
  let bracketDepth = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[') {
      bracketDepth++;
    } else if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (ch === '>' && bracketDepth === 0) {
      return i + 1;
    } else if (ch === '<' && text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    i++;
  }
  return text.length;
}

/** Splits markup into tokens. Malformed constructs degrade to text instead of throwing. */
export function tokenizeXml(text: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  const push = (token: XmlToken) => {
    if (tokens.length >= MAX_XML_TOKENS) throw new Error('SVG markup is too complex');
    tokens.push(token);
  };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      push({ kind: 'text', value: decodeXmlEntities(text.slice(i)) });
      break;
    }
    if (lt > i) push({ kind: 'text', value: decodeXmlEntities(text.slice(i, lt)) });
    i = lt;
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      const stop = end < 0 ? n : end;
      push({ kind: 'comment', value: text.slice(i + 4, stop) });
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      const stop = end < 0 ? n : end;
      push({ kind: 'cdata', value: text.slice(i + 9, stop) });
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      const stop = end < 0 ? n : end;
      push({ kind: 'pi', value: text.slice(i + 2, stop) });
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (text.startsWith('<!', i)) {
      const end = skipDeclaration(text, i);
      push({ kind: 'doctype', value: text.slice(i + 2, Math.max(i + 2, end - 1)) });
      i = end;
      continue;
    }
    if (text[i + 1] === '/') {
      let j = i + 2;
      while (j < n && NAME_CHAR.test(text[j]!)) j++;
      const name = text.slice(i + 2, j);
      const close = text.indexOf('>', j);
      if (name) push({ kind: 'end', name });
      else push({ kind: 'text', value: '</' });
      i = name ? (close < 0 ? n : close + 1) : i + 2;
      continue;
    }
    if (i + 1 >= n || !NAME_START.test(text[i + 1]!)) {
      push({ kind: 'text', value: '<' });
      i++;
      continue;
    }
    // Start tag.
    let j = i + 1;
    while (j < n && NAME_CHAR.test(text[j]!)) j++;
    const name = text.slice(i + 1, j);
    const attrs: XmlAttribute[] = [];
    const seen = new Set<string>();
    let selfClosing = false;
    let closed = false;
    while (j < n) {
      const ch = text[j]!;
      if (WHITESPACE.test(ch)) {
        j++;
        continue;
      }
      if (ch === '>') {
        j++;
        closed = true;
        break;
      }
      if (ch === '/' && text[j + 1] === '>') {
        j += 2;
        selfClosing = true;
        closed = true;
        break;
      }
      if (ch === '/' || ch === '=' || ch === '"' || ch === "'" || ch === '<') {
        if (ch === '<') break;
        j++;
        continue;
      }
      const nameStart = j;
      while (j < n && !/[\s/>="'<]/.test(text[j]!)) j++;
      const attrName = text.slice(nameStart, j);
      while (j < n && WHITESPACE.test(text[j]!)) j++;
      let rawValue = '';
      if (text[j] === '=') {
        j++;
        while (j < n && WHITESPACE.test(text[j]!)) j++;
        const q = text[j];
        if (q === '"' || q === "'") {
          const end = text.indexOf(q, j + 1);
          const stop = end < 0 ? n : end;
          rawValue = text.slice(j + 1, stop);
          j = end < 0 ? n : end + 1;
        } else {
          const valueStart = j;
          while (j < n && !/[\s>]/.test(text[j]!) && !(text[j] === '/' && text[j + 1] === '>')) j++;
          rawValue = text.slice(valueStart, j);
        }
      }
      if (!seen.has(attrName)) {
        seen.add(attrName);
        attrs.push({ name: attrName, value: decodeXmlEntities(rawValue) });
      }
    }
    push({ kind: 'start', name, attrs, selfClosing });
    i = closed ? j : Math.max(j, i + 1);
  }
  return tokens;
}

/**
 * Builds a lenient element tree. Comments, processing instructions and declarations are
 * discarded; stray end tags are ignored and unclosed elements are closed at end of input.
 */
export function parseXml(text: string): XmlNode[] {
  const tokens = tokenizeXml(text);
  const root: XmlElement = { kind: 'element', name: '#document', attrs: [], children: [] };
  const stack: XmlElement[] = [root];
  const appendText = (value: string) => {
    const parent = stack[stack.length - 1]!;
    const last = parent.children[parent.children.length - 1];
    if (last && last.kind === 'text') last.value += value;
    else parent.children.push({ kind: 'text', value });
  };
  for (const token of tokens) {
    switch (token.kind) {
      case 'start': {
        const el: XmlElement = { kind: 'element', name: token.name, attrs: token.attrs, children: [] };
        stack[stack.length - 1]!.children.push(el);
        if (!token.selfClosing) {
          if (stack.length > MAX_XML_DEPTH) throw new Error('SVG markup is nested too deeply');
          stack.push(el);
        }
        break;
      }
      case 'end': {
        for (let k = stack.length - 1; k > 0; k--) {
          if (stack[k]!.name === token.name) {
            stack.length = k;
            break;
          }
        }
        break;
      }
      case 'text':
      case 'cdata':
        appendText(token.value);
        break;
      default:
        break;
    }
  }
  return root.children;
}

export function getAttribute(el: XmlElement, name: string): string | undefined {
  for (const attr of el.attrs) if (attr.name === name) return attr.value;
  return undefined;
}

export function elementChildren(el: XmlElement): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.kind === 'element');
}

/** Local name of a possibly prefixed tag (`svg:rect` → `rect`), lower-cased. */
export function localName(name: string): string {
  const colon = name.indexOf(':');
  return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase();
}

const NUMBER_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** Extracts every number from a list such as `points`, `viewBox` or transform arguments. */
export function parseNumberList(value: string): number[] {
  return (value.match(NUMBER_RE) ?? []).map(Number).filter((v) => Number.isFinite(v));
}

const ABSOLUTE_UNITS: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6 };

/**
 * Parses an SVG length into user units (px). `em`/`ex` resolve against `fontSize`;
 * percentages and unknown units return null.
 */
export function parseSvgLength(value: string | undefined, fontSize = 16): number | null {
  if (value === undefined) return null;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(value);
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return null;
  const unit = m[2]!.toLowerCase();
  if (unit === 'em') return num * fontSize;
  if (unit === 'ex') return num * fontSize * 0.5;
  const factor = ABSOLUTE_UNITS[unit];
  return factor === undefined ? null : num * factor;
}

export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Parses a `viewBox` attribute; returns null unless it has four numbers and a positive size. */
export function parseViewBox(value: string | undefined): ViewBox | null {
  if (value === undefined) return null;
  const nums = parseNumberList(value);
  if (nums.length !== 4) return null;
  const [minX, minY, width, height] = nums as [number, number, number, number];
  if (!(width > 0) || !(height > 0)) return null;
  return { minX, minY, width, height };
}

/** Finds the first top-level `<svg>` element (ignoring whitespace, comments and prolog). */
export function findSvgRoot(nodes: readonly XmlNode[]): XmlElement | null {
  for (const node of nodes) {
    if (node.kind === 'text') {
      if (node.value.replace(/^\uFEFF/, '').trim() !== '') return null;
      continue;
    }
    return localName(node.name) === 'svg' ? node : null;
  }
  return null;
}

/**
 * Intrinsic size of an SVG root: `width`/`height` in absolute units, else derived from the
 * `viewBox` (keeping its aspect ratio when only one dimension is given), else 300×150.
 */
export function getSvgIntrinsicSize(root: XmlElement): { width: number; height: number } {
  const w = parseSvgLength(getAttribute(root, 'width'));
  const h = parseSvgLength(getAttribute(root, 'height'));
  const vb = parseViewBox(getAttribute(root, 'viewBox') ?? getAttribute(root, 'viewbox'));
  const width = w !== null && w > 0 ? w : null;
  const height = h !== null && h > 0 ? h : null;
  if (width !== null && height !== null) return { width, height };
  if (vb) {
    if (width !== null) return { width, height: (width * vb.height) / vb.width };
    if (height !== null) return { width: (height * vb.width) / vb.height, height };
    return { width: vb.width, height: vb.height };
  }
  return { width: width ?? 300, height: height ?? 150 };
}
