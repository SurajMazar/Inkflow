import { DOCUMENT_MIME_TYPE } from '@inkflow/scene';
import { ALLOWED_IMAGE_MIME_TYPES } from '@inkflow/shared';

export type ImportKind = 'inkflow' | 'excalidraw' | 'svg' | 'image' | 'mermaid' | 'unknown';

/** Diagram headers that start a Mermaid document. */
const MERMAID_HEADER =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|zenuml|sankey(?:-beta)?|xychart(?:-beta)?|block(?:-beta)?|packet(?:-beta)?|kanban|architecture(?:-beta)?|radar(?:-beta)?|treemap(?:-beta)?|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)(?=$|[\s;:{])/;

/** Removes a BOM, XML prolog/processing instructions, comments and DOCTYPE from the start of markup. */
function stripMarkupPreamble(text: string): string {
  let rest = text.replace(/^\uFEFF/, '');
  for (let guard = 0; guard < 64; guard++) {
    rest = rest.trimStart();
    if (rest.startsWith('<?')) {
      const end = rest.indexOf('?>');
      if (end < 0) return '';
      rest = rest.slice(end + 2);
    } else if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->');
      if (end < 0) return '';
      rest = rest.slice(end + 3);
    } else if (/^<!doctype/i.test(rest)) {
      const subset = rest.indexOf('[');
      const close = rest.indexOf('>');
      if (close < 0) return '';
      if (subset >= 0 && subset < close) {
        const subsetEnd = rest.indexOf(']', subset);
        if (subsetEnd < 0) return '';
        const after = rest.indexOf('>', subsetEnd);
        if (after < 0) return '';
        rest = rest.slice(after + 1);
      } else {
        rest = rest.slice(close + 1);
      }
    } else {
      return rest;
    }
  }
  return rest;
}

/** True when the text starts (after BOM, whitespace, prolog, comments, DOCTYPE) with an `<svg>` tag. */
export function looksLikeSvg(text: string): boolean {
  return /^<(?:svg:)?svg(?=[\s>/])/i.test(stripMarkupPreamble(text));
}

/** True when the first meaningful line is a Mermaid diagram header. */
export function looksLikeMermaid(text: string): boolean {
  let rest = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  // Optional YAML front matter (`---\ntitle: …\n---`).
  const frontMatter = /^\s*---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(rest);
  if (frontMatter) rest = rest.slice(frontMatter[0].length);
  // `%%{init: …}%%` directives may span lines.
  rest = rest.replace(/%%\{[\s\S]*?\}%%/g, '');
  for (const raw of rest.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('%%')) continue;
    return MERMAID_HEADER.test(line);
  }
  return false;
}

function detectJson(text: string): ImportKind | null {
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();
  if (!trimmed.startsWith('{')) return null;
  if (/"type"\s*:\s*"excalidraw(?:\/clipboard)?"/.test(trimmed)) return 'excalidraw';
  if (/"type"\s*:\s*"inkflow"/.test(trimmed)) return 'inkflow';
  if (/"elements"\s*:/.test(trimmed) && /"appState"\s*:/.test(trimmed)) return 'inkflow';
  return null;
}

/** Magic bytes of raster formats as they appear when binary data is decoded as Latin-1 or UTF-8. */
function looksLikeBinaryImage(head: string): boolean {
  const first = head.charCodeAt(0);
  if ((first === 0x89 || first === 0xfffd) && head.startsWith('PNG\r\n', 1) && head.charCodeAt(6) === 0x1a) return true;
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return true;
  if (first === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff) return true;
  return head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
}

function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Classifies a dropped/opened file. Content (`head` = the first few KB decoded as text) wins,
 * then the MIME type, then the file extension.
 */
export function detectImportKind(fileName: string, mime: string, head: string): ImportKind {
  const text = typeof head === 'string' ? head : '';
  const json = detectJson(text);
  if (json) return json;
  if (looksLikeSvg(text)) return 'svg';
  if (looksLikeBinaryImage(text)) return 'image';
  if (looksLikeMermaid(text)) return 'mermaid';

  const type = (typeof mime === 'string' ? mime : '').split(';')[0]!.trim().toLowerCase();
  if (type === 'image/svg+xml') return 'svg';
  if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(type)) return 'image';
  if (type === DOCUMENT_MIME_TYPE) return 'inkflow';
  if (type === 'text/vnd.mermaid' || type === 'text/x-mermaid') return 'mermaid';

  switch (extensionOf(typeof fileName === 'string' ? fileName : '')) {
    case 'inkflow':
      return 'inkflow';
    case 'excalidraw':
      return 'excalidraw';
    case 'svg':
      return 'svg';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return 'image';
    case 'mmd':
    case 'mermaid':
      return 'mermaid';
    default:
      // `.json` and everything else: the content did not match a known format.
      return 'unknown';
  }
}
