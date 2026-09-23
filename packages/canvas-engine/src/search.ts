import type { SceneElement } from '@inkflow/elements';

export interface SearchMatch {
  elementId: string;
  elementType: SceneElement['type'];
  /** Which property matched. */
  field: string;
  /** Full matched text (trimmed to a snippet). */
  text: string;
  /** Match offsets within `text`. */
  start: number;
  end: number;
}

function* searchableTexts(el: SceneElement): Generator<[field: string, text: string]> {
  if (el.type === 'text') yield ['text', el.text];
  if (el.type === 'frame') yield ['name', el.name];
  if ('label' in el && el.label) yield ['label', el.label.text];
  if (el.type === 'node') {
    for (const [k, v] of Object.entries(el.metadata)) yield [`metadata.${k}`, v];
  }
  if (el.type === 'table') {
    yield ['name', el.name];
    for (const c of el.columns) yield ['column', `${c.name} ${c.dataType}`];
  }
  if (el.type === 'uml-class') {
    yield ['name', el.name];
    for (const a of el.attributes) yield ['attribute', a];
    for (const m of el.methods) yield ['method', m];
  }
  if (el.type === 'sequence') {
    for (const p of el.participants) yield ['participant', p.name];
    for (const m of el.messages) yield ['message', m.label];
    for (const n of el.notes) yield ['note', n.text];
  }
  if (el.link) yield ['link', el.link];
}

function snippet(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } {
  const radius = 40;
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  const body = text.slice(from, to).replace(/\s+/g, ' ');
  return {
    text: prefix + body + suffix,
    start: start - from + prefix.length,
    end: end - from + prefix.length,
  };
}

/** Case-insensitive search over element text, labels, frame names and diagram models. */
export function searchScene(
  elements: readonly SceneElement[],
  query: string,
  limit = 200,
): SearchMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchMatch[] = [];
  for (const el of elements) {
    if (el.isDeleted || el.hidden) continue;
    for (const [field, text] of searchableTexts(el)) {
      const idx = text.toLowerCase().indexOf(q);
      if (idx === -1) continue;
      const s = snippet(text, idx, idx + q.length);
      out.push({ elementId: el.id, elementType: el.type, field, ...s });
      break;
    }
    if (out.length >= limit) break;
  }
  // Reading order: top-to-bottom, left-to-right.
  const pos = new Map(elements.map((e) => [e.id, e]));
  return out.sort((a, b) => {
    const ea = pos.get(a.elementId)!;
    const eb = pos.get(b.elementId)!;
    return Math.abs(ea.y - eb.y) > 20 ? ea.y - eb.y : ea.x - eb.x;
  });
}
