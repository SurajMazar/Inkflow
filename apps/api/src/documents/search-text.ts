import type { SceneElement } from '@inkflow/elements';

/** Upper bound of text indexed per element. */
export const MAX_SEARCH_TEXT = 8_000;

/**
 * Human-readable text of an element (text content, labels, names, table columns, UML members,
 * sequence participants/messages/notes) used for full-text search.
 */
export function extractSearchText(el: SceneElement): string {
  const parts: string[] = [];
  const push = (value: string | null | undefined) => {
    if (value && value.trim()) parts.push(value.trim());
  };
  switch (el.type) {
    case 'text':
      push(el.text);
      break;
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'triangle':
    case 'polygon':
    case 'star':
      push(el.label?.text);
      break;
    case 'line':
    case 'arrow':
    case 'connector':
      push(el.label?.text);
      break;
    case 'frame':
      push(el.name);
      break;
    case 'node':
      push(el.label?.text);
      for (const value of Object.values(el.metadata ?? {})) push(value);
      break;
    case 'table':
      push(el.name);
      for (const col of el.columns) push(`${col.name} ${col.dataType}`);
      break;
    case 'uml-class':
      push(el.stereotype);
      push(el.name);
      for (const a of el.attributes) push(a);
      for (const m of el.methods) push(m);
      break;
    case 'sequence':
      for (const p of el.participants) push(p.name);
      for (const m of el.messages) push(m.label);
      for (const n of el.notes) push(n.text);
      break;
    case 'freedraw':
    case 'image':
      break;
  }
  if (el.link) push(el.link);
  const text = parts.join('\n').split('\u0000').join('');
  return text.length > MAX_SEARCH_TEXT ? text.slice(0, MAX_SEARCH_TEXT) : text;
}

/** Short excerpt of `text` around the first case-insensitive occurrence of `query`. */
export function snippetAround(text: string, query: string, radius = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const idx = flat.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat;
  const start = Math.max(0, idx - radius);
  const end = Math.min(flat.length, idx + query.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}
