import type { Arrowhead, TableColumn, TableElement } from '@inkflow/elements';
import { autoLayout, createErRelationship, createErTable, DiagramBuilder, type LayoutDirection } from '@inkflow/diagram-engine';
import { cleanLabel, IssueLog, layoutEdge, MAX_MERMAID_EDGES, MAX_MERMAID_NODES, type MermaidResult } from './common';

interface Entity {
  name: string;
  label: string;
  columns: Array<Partial<TableColumn> & { name: string }>;
}

interface Relationship {
  from: string;
  to: string;
  start: Arrowhead;
  end: Arrowhead;
  identifying: boolean;
  label: string;
}

const ENTITY_ID = String.raw`[\p{L}\p{N}_-]+|"[^"]+"`;
const ENTITY_START = new RegExp(String.raw`^(${ENTITY_ID})(?:\s*\[\s*"?([^"\]]*)"?\s*\])?\s*\{(.*)$`, 'u');
const RELATIONSHIP = new RegExp(String.raw`^(${ENTITY_ID})\s+(\S{2})(--|\.\.)(\S{2})\s+(${ENTITY_ID})\s*(?::\s*(.*))?$`, 'u');
const ATTRIBUTE = /^([\p{L}\p{N}_()[\],.<>~-]+)\s+(\*?[\p{L}\p{N}_-]+)((?:\s+(?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?)(?:\s+"([^"]*)")?$/iu;

/**
 * Crow's-foot marker → arrowhead. Mermaid writes the left end as `||`, `|o`, `}|`, `}o` and the
 * right end mirrored (`||`, `o|`, `|{`, `o{`); both orientations are accepted.
 */
function cardinality(token: string): Arrowhead | null {
  if (!/^[|o}{]{2}$/.test(token)) return null;
  const many = token.includes('{') || token.includes('}');
  const zero = token.includes('o');
  if (many) return zero ? 'er-zero-many' : 'er-one-many';
  return zero ? 'er-zero-one' : 'er-one-only';
}

const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1');

/** Mermaid `erDiagram` → tables with typed PK/FK/UK columns and crow's-foot relationships. */
export function importEr(lines: string[]): MermaidResult {
  const issues = new IssueLog();
  const entities = new Map<string, Entity>();
  const relationships: Relationship[] = [];
  let direction: LayoutDirection = 'LR';
  let open: Entity | null = null;

  const ensure = (raw: string, label?: string) => {
    const name = unquote(raw.trim()).slice(0, 200);
    let e = entities.get(name);
    if (!e) {
      if (entities.size >= MAX_MERMAID_NODES) {
        issues.add(`Too many entities; only the first ${MAX_MERMAID_NODES} were imported`);
        return null;
      }
      e = { name, label: name, columns: [] };
      entities.set(name, e);
    }
    if (label) e.label = cleanLabel(label).slice(0, 200) || e.label;
    return e;
  };

  const addAttribute = (entity: Entity, text: string) => {
    const m = ATTRIBUTE.exec(text.trim());
    if (!m) {
      issues.add(`Could not parse attribute: ${text.trim().slice(0, 80)}`);
      return;
    }
    if (entity.columns.length >= 500) {
      issues.add('Tables are limited to 500 columns');
      return;
    }
    const keys = (m[3] ?? '').toUpperCase();
    const pk = keys.includes('PK') || m[2]!.startsWith('*');
    entity.columns.push({
      name: m[2]!.replace(/^\*/, '').slice(0, 200),
      dataType: m[1]!.replace(/~/g, '').slice(0, 100),
      primaryKey: pk,
      foreignKey: keys.includes('FK'),
      unique: keys.includes('UK'),
      nullable: !pk,
    });
    if (m[4]) issues.add('Attribute comments are not imported');
  };

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]!;
    if (open) {
      if (line.startsWith('}')) {
        open = null;
        continue;
      }
      const close = line.lastIndexOf('}');
      if (close >= 0) {
        for (const part of line.slice(0, close).split(/\s{2,}|\n/)) if (part.trim()) addAttribute(open, part);
        open = null;
        continue;
      }
      addAttribute(open, line);
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(line))) {
      const d = m[1]!.toUpperCase();
      direction = (d === 'TD' ? 'TB' : d) as LayoutDirection;
      continue;
    }
    if (/^(title|accTitle|accDescr|style|classDef|class)\b/i.test(line)) continue;
    if ((m = ENTITY_START.exec(line))) {
      const e = ensure(m[1]!, m[2]);
      if (!e) continue;
      const rest = m[3]!.trim();
      if (rest.endsWith('}')) {
        const body = rest.slice(0, -1).trim();
        if (body) for (const part of body.split(/\s{2,}|;/)) if (part.trim()) addAttribute(e, part);
      } else {
        open = e;
        if (rest) addAttribute(e, rest);
      }
      continue;
    }
    if ((m = RELATIONSHIP.exec(line))) {
      const start = cardinality(m[2]!);
      const end = cardinality(m[4]!);
      const a = ensure(m[1]!);
      const b = ensure(m[5]!);
      if (!start || !end || !a || !b) {
        issues.add(`Could not parse relationship: ${line.slice(0, 80)}`);
        continue;
      }
      if (relationships.length >= MAX_MERMAID_EDGES) {
        issues.add(`Too many relationships; only the first ${MAX_MERMAID_EDGES} were imported`);
        continue;
      }
      relationships.push({ from: a.name, to: b.name, start, end, identifying: m[3] === '--', label: cleanLabel(m[6] ?? '') });
      continue;
    }
    if ((m = new RegExp(String.raw`^(${ENTITY_ID})$`, 'u').exec(line))) {
      ensure(m[1]!);
      continue;
    }
    issues.add(`Could not parse erDiagram line: ${line.slice(0, 80)}`);
  }
  if (open) issues.add('Unclosed entity block');

  const tables = new Map<string, TableElement>();
  for (const e of entities.values()) tables.set(e.name, createErTable(e.label, e.columns));
  const byId = new Map([...tables].map(([name, t]) => [t.id, name]));
  const edges = relationships.map((r) => layoutEdge(tables.get(r.from)!.id, tables.get(r.to)!.id));
  const pos = autoLayout([...tables.values()], edges, 'hierarchical', { direction, nodeSpacing: 60, rankSpacing: 120 });
  const b = new DiagramBuilder();
  const placed = new Map<string, TableElement>();
  for (const t of tables.values()) {
    const p = pos.get(t.id) ?? { x: 0, y: 0 };
    placed.set(byId.get(t.id)!, b.add({ ...t, x: p.x, y: p.y }));
  }
  for (const r of relationships) {
    b.add(
      createErRelationship(placed.get(r.from)!, null, placed.get(r.to)!, null, 'one-to-many', {
        startArrowhead: r.start,
        endArrowhead: r.end,
        strokeStyle: r.identifying ? 'solid' : 'dashed',
        ...(r.label ? { label: r.label } : {}),
      }),
    );
  }
  return { elements: b.finish(), issues: issues.list() };
}
