import { importClass } from './class';
import { MAX_MERMAID_CHARS, mermaidLines, type MermaidResult } from './common';
import { importEr } from './er';
import { importFlowchart } from './flowchart';
import { importSequence } from './sequence';

export { formatMember } from './class';
export { cleanLabel, mermaidLines, type MermaidResult } from './common';

/**
 * Converts Mermaid source into native, editable elements. Supported diagrams: `flowchart` /
 * `graph`, `sequenceDiagram`, `erDiagram` and `classDiagram`. The text is parsed as data only
 * (never evaluated or rendered as HTML); unsupported statements are reported in `issues`.
 * Layout uses the hierarchical (Sugiyama) auto layout; connectors are bound to their nodes.
 */
export function importMermaid(text: string): MermaidResult {
  if (typeof text !== 'string') throw new Error('Mermaid source must be text');
  if (text.length > MAX_MERMAID_CHARS)
    throw new Error('Mermaid source is too large to import (max 1 MB)');
  const lines = mermaidLines(text);
  const header = lines[0] ?? '';
  if (/^(flowchart|graph)\b/i.test(header)) return importFlowchart(lines);
  if (/^sequenceDiagram\b/i.test(header)) return importSequence(lines);
  if (/^erDiagram\b/i.test(header)) return importEr(lines);
  if (/^classDiagram(-v2)?\b/i.test(header)) return importClass(lines);
  const kind = /^([A-Za-z-]+)/.exec(header)?.[1];
  return {
    elements: [],
    issues: [
      kind ? `Unsupported Mermaid diagram type "${kind.slice(0, 40)}"` : 'Empty Mermaid source',
    ],
  };
}
