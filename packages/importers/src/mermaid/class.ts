import type { SceneElement, UmlClassElement } from '@inkflow/elements';
import { autoLayout, createNode, createUmlClass, createUmlRelation, DiagramBuilder, type LayoutDirection, type UmlRelationKind } from '@inkflow/diagram-engine';
import { cleanLabel, IssueLog, layoutEdge, MAX_MERMAID_EDGES, MAX_MERMAID_NODES, type MermaidResult } from './common';

interface ClassDef {
  id: string;
  name: string;
  stereotype: string | null;
  attributes: string[];
  methods: string[];
}

interface Relation {
  a: string;
  b: string;
  token: string;
  cardA: string;
  cardB: string;
  label: string;
}

interface Note {
  target: string | null;
  text: string;
}

const CLASS_ID = String.raw`[\p{L}\p{N}_]+(?:~[^~]{1,100}~)?`;
/** Relation tokens, longest first (left marker, line, right marker). */
const TOKENS = ['<|--', '<|..', '--|>', '..|>', '*--', 'o--', '--*', '--o', '<--', '<..', '-->', '..>', '--', '..'];
const RELATION = new RegExp(
  String.raw`^(${CLASS_ID})\s*(?:"([^"]*)")?\s*(${TOKENS.map((t) => t.replace(/[|*.]/g, '\\$&')).join('|')})\s*(?:"([^"]*)")?\s*(${CLASS_ID})\s*(?::\s*(.*))?$`,
  'u',
);

const displayName = (id: string) => id.replace(/~([^~]*)~/g, '<$1>').slice(0, 200);

/**
 * Mermaid member → UML text: `+String name` → `+ name: String`, `+getName(id) String` →
 * `+ getName(id): String`; static (`$`) and abstract (`*`) markers are preserved as suffixes.
 */
export function formatMember(raw: string): { text: string; method: boolean } {
  let s = raw.trim().replace(/~([^~]*)~/g, '<$1>');
  let suffix = '';
  const marker = /([$*]+)$/.exec(s);
  if (marker) {
    suffix = marker[1]!;
    s = s.slice(0, -suffix.length).trimEnd();
  }
  const vis = /^[+\-#~]/.test(s) ? s[0]! : '';
  if (vis) s = s.slice(1).trim();
  const lead = vis ? `${vis} ` : '';
  const method = /^([\p{L}\p{N}_]+)\s*\(([^)]*)\)\s*(.*)$/u.exec(s);
  if (method) {
    let ret = method[3]!.trim();
    const leading = /^([$*]+)\s*/.exec(ret);
    if (leading) {
      suffix = leading[1]! + suffix;
      ret = ret.slice(leading[0].length);
    }
    const retMarker = /([$*]+)$/.exec(ret);
    if (retMarker) {
      suffix = retMarker[1]! + suffix;
      ret = ret.slice(0, -retMarker[1]!.length).trim();
    }
    return { text: `${lead}${method[1]}(${method[2]!.trim()})${ret ? `: ${ret}` : ''}${suffix}`.slice(0, 2000), method: true };
  }
  if (s.includes(':')) return { text: `${lead}${s}${suffix}`.slice(0, 2000), method: false };
  const parts = s.split(/\s+/);
  if (parts.length >= 2) {
    const name = parts.pop()!;
    return { text: `${lead}${name}: ${parts.join(' ')}${suffix}`.slice(0, 2000), method: false };
  }
  return { text: `${lead}${s}${suffix}`.slice(0, 2000), method: false };
}

interface Mapped {
  from: 'a' | 'b';
  kind: UmlRelationKind;
  end: 'arrow' | 'none';
}

/** Relation token → UML kind and which side is the builder's `from` end. */
function mapToken(token: string): Mapped {
  switch (token) {
    case '<|--':
      return { from: 'b', kind: 'inheritance', end: 'arrow' };
    case '--|>':
      return { from: 'a', kind: 'inheritance', end: 'arrow' };
    case '<|..':
      return { from: 'b', kind: 'realization', end: 'arrow' };
    case '..|>':
      return { from: 'a', kind: 'realization', end: 'arrow' };
    case '*--':
      return { from: 'a', kind: 'composition', end: 'arrow' };
    case '--*':
      return { from: 'b', kind: 'composition', end: 'arrow' };
    case 'o--':
      return { from: 'a', kind: 'aggregation', end: 'arrow' };
    case '--o':
      return { from: 'b', kind: 'aggregation', end: 'arrow' };
    case '-->':
      return { from: 'a', kind: 'association', end: 'arrow' };
    case '<--':
      return { from: 'b', kind: 'association', end: 'arrow' };
    case '..>':
      return { from: 'a', kind: 'dependency', end: 'arrow' };
    case '<..':
      return { from: 'b', kind: 'dependency', end: 'arrow' };
    case '..':
      return { from: 'a', kind: 'dependency', end: 'none' };
    default:
      return { from: 'a', kind: 'association', end: 'none' };
  }
}

/** Mermaid `classDiagram` → UML class boxes and relations (supertypes laid out above subtypes). */
export function importClass(lines: string[]): MermaidResult {
  const issues = new IssueLog();
  const classes = new Map<string, ClassDef>();
  const relations: Relation[] = [];
  const notes: Note[] = [];
  let direction: LayoutDirection = 'TB';
  let open: ClassDef | null = null;
  let namespaceDepth = 0;

  const ensure = (rawId: string) => {
    const id = rawId.trim();
    let c = classes.get(id);
    if (!c) {
      if (classes.size >= MAX_MERMAID_NODES) {
        issues.add(`Too many classes; only the first ${MAX_MERMAID_NODES} were imported`);
        return null;
      }
      c = { id, name: displayName(id), stereotype: null, attributes: [], methods: [] };
      classes.set(id, c);
    }
    return c;
  };
  const addMember = (c: ClassDef, raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const annotation = /^<<\s*(.+?)\s*>>$/.exec(text);
    if (annotation) {
      c.stereotype = cleanLabel(annotation[1]!).slice(0, 100);
      return;
    }
    const member = formatMember(text);
    const list = member.method ? c.methods : c.attributes;
    if (list.length < 500) list.push(member.text);
  };

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]!;
    if (open) {
      if (line.startsWith('}')) {
        open = null;
        continue;
      }
      addMember(open, line);
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(line))) {
      const d = m[1]!.toUpperCase();
      direction = (d === 'TD' ? 'TB' : d) as LayoutDirection;
      continue;
    }
    if (/^namespace\s+[\p{L}\p{N}_.]+\s*\{$/iu.test(line)) {
      namespaceDepth++;
      continue;
    }
    if (line === '}' && namespaceDepth > 0) {
      namespaceDepth--;
      continue;
    }
    if (/^(title|accTitle|accDescr|style|classDef|cssClass|callback|link|click)\b/i.test(line)) {
      if (/^(callback|link|click)\b/i.test(line)) issues.add('Interactive "click"/"link" statements are ignored');
      continue;
    }
    if ((m = new RegExp(String.raw`^class\s+(${CLASS_ID})(?:\s*\["([^"]*)"\])?(?::::[\w-]+)?\s*(\{)?\s*(.*?)\s*(\})?$`, 'u').exec(line))) {
      const c = ensure(m[1]!);
      if (!c) continue;
      if (m[2]) c.name = cleanLabel(m[2]).slice(0, 200);
      if (m[3] && !m[5]) {
        open = c;
        if (m[4]) addMember(c, m[4]);
      } else if (m[3] && m[5] && m[4]) {
        for (const part of m[4].split(/;|\s{2,}/)) addMember(c, part);
      }
      continue;
    }
    if ((m = new RegExp(String.raw`^<<\s*(.+?)\s*>>\s*(${CLASS_ID})$`, 'u').exec(line))) {
      const c = ensure(m[2]!);
      if (c) c.stereotype = cleanLabel(m[1]!).slice(0, 100);
      continue;
    }
    if ((m = /^note\s+(?:for\s+([\p{L}\p{N}_]+)\s+)?"([^"]*)"$/iu.exec(line))) {
      notes.push({ target: m[1] ?? null, text: cleanLabel(m[2]!) });
      continue;
    }
    if ((m = RELATION.exec(line))) {
      const a = ensure(m[1]!);
      const b = ensure(m[5]!);
      if (!a || !b) continue;
      if (relations.length >= MAX_MERMAID_EDGES) {
        issues.add(`Too many relations; only the first ${MAX_MERMAID_EDGES} were imported`);
        continue;
      }
      relations.push({ a: a.id, b: b.id, token: m[3]!, cardA: m[2] ?? '', cardB: m[4] ?? '', label: cleanLabel(m[6] ?? '') });
      continue;
    }
    if ((m = new RegExp(String.raw`^(${CLASS_ID})\s*:\s*(.+)$`, 'u').exec(line))) {
      const c = ensure(m[1]!);
      if (c) addMember(c, m[2]!);
      continue;
    }
    if ((m = new RegExp(String.raw`^(${CLASS_ID})$`, 'u').exec(line))) {
      ensure(m[1]!);
      continue;
    }
    issues.add(`Could not parse classDiagram line: ${line.slice(0, 80)}`);
  }
  if (open) issues.add('Unclosed class block');

  const boxes = new Map<string, UmlClassElement>();
  for (const c of classes.values()) {
    const abstract = c.stereotype?.toLowerCase() === 'abstract';
    boxes.set(c.id, createUmlClass(c.name, c.attributes, c.methods, { stereotype: c.stereotype, isAbstract: abstract }));
  }
  const noteNodes = notes.map((n) => ({ note: n, el: createNode('note', { label: n.text, width: 180, height: 80 }) }));
  // Layout edges point from the element that should sit above: supertypes and wholes first.
  const layoutEdges = relations.map((r) => {
    const map = mapToken(r.token);
    const [from, to] = map.from === 'a' ? [r.a, r.b] : [r.b, r.a];
    const above = map.kind === 'inheritance' || map.kind === 'realization' ? [to, from] : [from, to];
    return layoutEdge(boxes.get(above[0]!)!.id, boxes.get(above[1]!)!.id);
  });
  for (const { note, el } of noteNodes) {
    const target = note.target ? boxes.get(note.target) : undefined;
    if (target) layoutEdges.push(layoutEdge(el.id, target.id));
  }
  const all: SceneElement[] = [...boxes.values(), ...noteNodes.map((n) => n.el)];
  const pos = autoLayout(all, layoutEdges, 'hierarchical', { direction, nodeSpacing: 60, rankSpacing: 90 });
  const b = new DiagramBuilder();
  const placed = new Map<string, SceneElement>();
  for (const [id, box] of boxes) {
    const p = pos.get(box.id) ?? { x: 0, y: 0 };
    placed.set(id, b.add({ ...box, x: p.x, y: p.y }));
  }
  for (const r of relations) {
    const map = mapToken(r.token);
    const [from, to] = map.from === 'a' ? [r.a, r.b] : [r.b, r.a];
    const [cardFrom, cardTo] = map.from === 'a' ? [r.cardA, r.cardB] : [r.cardB, r.cardA];
    const label = [cardFrom, r.label, cardTo].filter(Boolean).join(' ');
    b.add(
      createUmlRelation(placed.get(from)!, placed.get(to)!, map.kind, {
        ...(map.end === 'none' ? { endArrowhead: 'none' as const } : {}),
        ...(label ? { label } : {}),
      }),
    );
  }
  for (const { note, el } of noteNodes) {
    const p = pos.get(el.id) ?? { x: 0, y: 0 };
    const n = b.add({ ...el, x: p.x, y: p.y });
    const target = note.target ? placed.get(note.target) : undefined;
    if (target) b.connect(n, target, { routing: 'straight', strokeStyle: 'dashed', endArrowhead: 'none', edgeKind: 'association', fromPort: null, toPort: null });
  }
  return { elements: b.finish(), issues: issues.list() };
}
