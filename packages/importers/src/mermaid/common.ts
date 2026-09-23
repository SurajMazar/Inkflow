import { createBinding, createElement, type LinearElement, type SceneElement } from '@inkflow/elements';

/** Hard limits that keep hostile input from exhausting memory or CPU. */
export const MAX_MERMAID_CHARS = 1_000_000;
export const MAX_MERMAID_LINES = 20_000;
export const MAX_MERMAID_NODES = 2_000;
export const MAX_MERMAID_EDGES = 5_000;

export interface MermaidResult {
  elements: SceneElement[];
  issues: string[];
}

/** Collects issues, merging repeated messages. */
export class IssueLog {
  private readonly counts = new Map<string, number>();

  add(message: string): void {
    this.counts.set(message, (this.counts.get(message) ?? 0) + 1);
  }

  list(): string[] {
    return [...this.counts].map(([m, n]) => (n > 1 ? `${m} (${n} times)` : m));
  }
}

/**
 * Splits Mermaid source into logical lines: strips YAML front matter, `%%{init}%%` directives and
 * `%%` comments, splits on newlines and statement-separating semicolons outside quotes/brackets.
 */
export function mermaidLines(text: string): string[] {
  let src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const front = /^\s*---\n[\s\S]*?\n---\s*\n/.exec(src);
  if (front) src = src.slice(front[0].length);
  src = src.replace(/%%\{[\s\S]*?\}%%/g, '');
  const out: string[] = [];
  for (const raw of src.split('\n')) {
    let line = raw;
    const comment = line.indexOf('%%');
    if (comment >= 0) line = line.slice(0, comment);
    for (const part of splitStatements(line)) {
      const t = part.trim();
      if (t) out.push(t);
    }
    if (out.length > MAX_MERMAID_LINES) break;
  }
  return out;
}

function splitStatements(line: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') quote = !quote;
    else if (!quote && '([{'.includes(ch)) depth++;
    else if (!quote && ')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (!quote && depth === 0 && ch === ';') {
      parts.push(line.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(line.slice(start));
  return parts;
}

/**
 * Converts Mermaid label markup to plain text: `<br>` → newline, other tags removed, Mermaid
 * entity codes (`#quot;`, `#35;`) and XML entities decoded, markdown emphasis markers removed.
 * Labels are always treated as text, never as HTML.
 */
export function cleanLabel(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) s = s.slice(1, -1);
  if (s.startsWith('`') && s.endsWith('`') && s.length >= 2) s = s.slice(1, -1);
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
  s = s.replace(/#(\d{1,6});/g, (_, n: string) => safeChar(Number(n)));
  const named: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' };
  s = s.replace(/#([a-z]+);/gi, (m, name: string) => named[name.toLowerCase()] ?? m);
  s = s.replace(/&(quot|amp|lt|gt|apos|nbsp);/gi, (_, name: string) => named[name.toLowerCase()]!);
  s = s.replace(/&#(\d{1,6});/g, (_, n: string) => safeChar(Number(n)));
  s = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1$2');
  return s.replace(/\\n/g, '\n').slice(0, 2000);
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
  return String.fromCodePoint(code);
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.\s,%]+\))$/i;

/** Parses `fill:#f9f,stroke:#333,stroke-width:4px` style lists (colors only, validated). */
export function parseStyleList(list: string): { fill?: string; stroke?: string; strokeWidth?: number; dashed?: boolean; color?: string } {
  const out: { fill?: string; stroke?: string; strokeWidth?: number; dashed?: boolean; color?: string } = {};
  for (const decl of list.split(/,(?![^(]*\))/)) {
    const [k, v] = decl.split(':').map((x) => x.trim());
    if (!k || !v) continue;
    const key = k.toLowerCase();
    if ((key === 'fill' || key === 'stroke' || key === 'color') && COLOR_RE.test(v)) out[key] = v;
    else if (key === 'stroke-width') {
      const n = parseFloat(v);
      if (Number.isFinite(n) && n > 0 && n <= 20) out.strokeWidth = n;
    } else if (key === 'stroke-dasharray') out.dashed = true;
  }
  return out;
}

/** Lightweight edge used only to drive `autoLayout`. */
export function layoutEdge(from: string, to: string): LinearElement {
  return createElement('connector', { startBinding: createBinding(from), endBinding: createBinding(to) });
}
