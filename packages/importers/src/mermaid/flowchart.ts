import { getFontString, measureLineWidth, type Arrowhead, type NodeElement, type SceneElement } from '@inkflow/elements';
import { autoLayout, createNode, DiagramBuilder, type LayoutDirection } from '@inkflow/diagram-engine';
import { cleanLabel, IssueLog, layoutEdge, MAX_MERMAID_EDGES, MAX_MERMAID_NODES, parseStyleList, type MermaidResult } from './common';

interface FNode {
  id: string;
  label: string;
  shape: string;
  flipX: boolean;
  strokeWidth?: number;
  group: string | null;
  classes: string[];
  explicit: boolean;
}

interface FEdge {
  from: string;
  to: string;
  label: string;
  start: Arrowhead;
  end: Arrowhead;
  style: 'solid' | 'dashed';
  thick: boolean;
  invisible: boolean;
}

interface FGroup {
  id: string;
  title: string;
  parent: string | null;
  direction: LayoutDirection | null;
}

type Style = ReturnType<typeof parseStyleList>;

/** Node bracket syntaxes, longest openers first. */
const SHAPES: { open: string; close: string; shape: string; flipX?: boolean; strokeWidth?: number }[] = [
  { open: '(((', close: ')))', shape: 'circle', strokeWidth: 4 },
  { open: '([', close: '])', shape: 'terminator' },
  { open: '[[', close: ']]', shape: 'predefined-process' },
  { open: '[(', close: ')]', shape: 'database' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[/', close: '/]', shape: 'parallelogram' },
  { open: '[/', close: '\\]', shape: 'trapezoid' },
  { open: '[\\', close: '\\]', shape: 'parallelogram', flipX: true },
  { open: '[\\', close: '/]', shape: 'manual-operation' },
  { open: '[', close: ']', shape: 'process' },
  { open: '(', close: ')', shape: 'rounded-rectangle' },
  { open: '{', close: '}', shape: 'decision' },
  { open: '>', close: ']', shape: 'flag' },
];

const ID_RE = /[\p{L}\p{N}_]+(?:[.-][\p{L}\p{N}_]+)*/uy;
const LINK_RE = /(<)?(-\.+->|-\.+-|={2,}>|={3,}|-{2,}>|-{2,}o(?![\p{L}\p{N}_])|-{2,}x(?![\p{L}\p{N}_])|-{3,}|~{3,})/uy;
const INLINE_RE = /(<)?(--|==|-\.)(?=\s)/y;
const INLINE_CLOSERS: Record<string, RegExp> = {
  '--': /\s(-{2,}>|-{3,}|-{2,}o|-{2,}x)/,
  '==': /\s(={2,}>|={3,})/,
  '-.': /\s(\.-+>|\.-+)/,
};
const PIPE_RE = /\|([^|]*)\|/y;

class Scanner {
  i = 0;
  constructor(readonly s: string) {}
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }
  done() {
    this.ws();
    return this.i >= this.s.length;
  }
  sticky(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (m) this.i = re.lastIndex;
    return m;
  }
}

interface NodeRef {
  id: string;
  label?: string;
  shape?: (typeof SHAPES)[number];
  classes: string[];
}

function readBracketText(sc: Scanner, close: string): string | null {
  const s = sc.s;
  let j = sc.i;
  while (j < s.length && s[j] === ' ') j++;
  if (s[j] === '"') {
    const end = s.indexOf('"', j + 1);
    if (end < 0) return null;
    let k = end + 1;
    while (k < s.length && s[k] === ' ') k++;
    if (!s.startsWith(close, k)) return null;
    sc.i = k + close.length;
    return s.slice(j, end + 1);
  }
  const end = s.indexOf(close, sc.i);
  if (end < 0) return null;
  const text = s.slice(sc.i, end);
  sc.i = end + close.length;
  return text;
}

function parseNodeRef(sc: Scanner): NodeRef | null {
  sc.ws();
  const m = sc.sticky(ID_RE);
  if (!m) return null;
  const ref: NodeRef = { id: m[0], classes: [] };
  for (const shape of SHAPES) {
    if (!sc.s.startsWith(shape.open, sc.i)) continue;
    const save = sc.i;
    sc.i += shape.open.length;
    const text = readBracketText(sc, shape.close);
    if (text === null) {
      sc.i = save;
      continue;
    }
    ref.label = text;
    ref.shape = shape;
    break;
  }
  while (sc.s.startsWith(':::', sc.i)) {
    sc.i += 3;
    const c = sc.sticky(ID_RE);
    if (c) ref.classes.push(c[0]);
  }
  return ref;
}

function parseNodeGroup(sc: Scanner): NodeRef[] | null {
  const first = parseNodeRef(sc);
  if (!first) return null;
  const refs = [first];
  for (;;) {
    const save = sc.i;
    sc.ws();
    if (sc.s[sc.i] !== '&') {
      sc.i = save;
      break;
    }
    sc.i++;
    const next = parseNodeRef(sc);
    if (!next) return null;
    refs.push(next);
  }
  return refs;
}

interface Link {
  start: Arrowhead;
  end: Arrowhead;
  style: 'solid' | 'dashed';
  thick: boolean;
  invisible: boolean;
  label: string;
}

function linkFromToken(bidirectional: boolean, token: string, label: string): Link {
  const last = token[token.length - 1]!;
  const end: Arrowhead = last === '>' ? 'triangle' : last === 'o' ? 'circle-outline' : last === 'x' ? 'bar' : 'none';
  return {
    start: bidirectional ? 'triangle' : 'none',
    end,
    style: token.includes('.') ? 'dashed' : 'solid',
    thick: token.startsWith('='),
    invisible: token.startsWith('~'),
    label,
  };
}

function parseLink(sc: Scanner): Link | null {
  sc.ws();
  let link: Link | null = null;
  const m = sc.sticky(LINK_RE);
  if (m) link = linkFromToken(!!m[1], m[2]!, '');
  else {
    const inline = sc.sticky(INLINE_RE);
    if (!inline) return null;
    const closer = INLINE_CLOSERS[inline[2]!]!;
    const rest = sc.s.slice(sc.i);
    const c = closer.exec(rest);
    if (!c) return null;
    const label = rest.slice(0, c.index);
    sc.i += c.index + c[0].length;
    link = linkFromToken(!!inline[1], inline[2]! + c[1]!, cleanLabel(label));
  }
  sc.ws();
  const pipe = sc.sticky(PIPE_RE);
  if (pipe) link.label = cleanLabel(pipe[1]!);
  return link;
}

function directionOf(token: string | undefined): LayoutDirection | null {
  const t = token?.toUpperCase();
  if (t === 'TB' || t === 'TD') return 'TB';
  if (t === 'BT' || t === 'LR' || t === 'RL') return t;
  return null;
}

const FONT = getFontString({ fontFamily: 'sans', fontSize: 16 });

function sizeFor(shape: string, label: string, base: NodeElement): { width: number; height: number } {
  const lines = label.split('\n');
  const tw = Math.max(0, ...lines.map((l) => measureLineWidth(l, FONT)));
  const th = lines.length * 20;
  let width = Math.max(base.width, tw + 48);
  let height = Math.max(base.height, th + 28);
  if (shape === 'decision' || shape === 'hexagon') {
    width = Math.max(base.width, tw * 1.6 + 40);
    height = Math.max(base.height, th * 2 + 30);
  }
  if (shape === 'circle') {
    const d = Math.max(base.width, tw + 36, th + 36);
    width = d;
    height = d;
  }
  if (shape === 'parallelogram' || shape === 'trapezoid' || shape === 'manual-operation' || shape === 'flag') width += 30;
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

/** Mermaid `flowchart` / `graph` → nodes, bound connectors and subgraph frames (Sugiyama layout). */
export function importFlowchart(lines: string[]): MermaidResult {
  const issues = new IssueLog();
  const header = /^(?:flowchart|graph)\b\s*(\w+)?/i.exec(lines[0] ?? '');
  const direction = directionOf(header?.[1]) ?? 'TB';
  const nodes = new Map<string, FNode>();
  const edges: FEdge[] = [];
  const groups = new Map<string, FGroup>();
  const stack: string[] = [];
  const classDefs = new Map<string, Style>();
  const nodeStyles = new Map<string, Style>();
  let groupSeq = 0;

  const touch = (ref: NodeRef) => {
    let n = nodes.get(ref.id);
    if (!n) {
      if (nodes.size >= MAX_MERMAID_NODES) {
        issues.add(`Too many nodes; only the first ${MAX_MERMAID_NODES} were imported`);
        return null;
      }
      n = { id: ref.id, label: ref.id, shape: 'process', flipX: false, group: stack[stack.length - 1] ?? null, classes: [], explicit: false };
      nodes.set(ref.id, n);
    }
    if (ref.shape) {
      n.shape = ref.shape.shape;
      n.flipX = !!ref.shape.flipX;
      if (ref.shape.strokeWidth) n.strokeWidth = ref.shape.strokeWidth;
      n.label = cleanLabel(ref.label ?? ref.id);
      n.explicit = true;
    }
    // A node mentioned inside a subgraph belongs to it (the last subgraph mentioning it wins).
    if (stack.length > 0) n.group = stack[stack.length - 1]!;
    n.classes.push(...ref.classes);
    return n;
  };

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]!;
    let m: RegExpExecArray | null;
    if ((m = /^subgraph\s+(.+)$/i.exec(line))) {
      const rest = m[1]!.trim();
      let id: string;
      let title: string;
      const withTitle = /^([\p{L}\p{N}_.-]+)\s*\[(.+)\]$/u.exec(rest);
      if (withTitle) {
        id = withTitle[1]!;
        title = cleanLabel(withTitle[2]!);
      } else if (/^[\p{L}\p{N}_.-]+$/u.test(rest)) {
        id = rest;
        title = rest;
      } else {
        id = `__subgraph_${groupSeq++}`;
        title = cleanLabel(rest);
      }
      groups.set(id, { id, title, parent: stack[stack.length - 1] ?? null, direction: null });
      stack.push(id);
      continue;
    }
    if (/^end$/i.test(line)) {
      if (stack.length === 0) issues.add('Unmatched "end"');
      stack.pop();
      continue;
    }
    if ((m = /^direction\s+(\w+)$/i.exec(line))) {
      const g = groups.get(stack[stack.length - 1] ?? '');
      if (g) g.direction = directionOf(m[1]);
      continue;
    }
    if ((m = /^classDef\s+([\w,-]+)\s+(.+)$/i.exec(line))) {
      for (const name of m[1]!.split(',')) classDefs.set(name.trim(), parseStyleList(m[2]!));
      continue;
    }
    if ((m = /^class\s+([\p{L}\p{N}_.,\s-]+?)\s+([\w-]+)$/iu.exec(line))) {
      for (const id of m[1]!.split(',')) {
        const n = nodes.get(id.trim());
        if (n) n.classes.push(m[2]!);
      }
      continue;
    }
    if ((m = /^style\s+([\p{L}\p{N}_.-]+)\s+(.+)$/iu.exec(line))) {
      nodeStyles.set(m[1]!, parseStyleList(m[2]!));
      continue;
    }
    if (/^(linkStyle|accTitle|accDescr|title)\b/i.test(line)) continue;
    if (/^(click|callback|href)\b/i.test(line)) {
      issues.add('Interactive "click" handlers are ignored');
      continue;
    }
    if (/@\{/.test(line)) {
      issues.add('Extended node syntax (@{ … }) is not supported');
      continue;
    }
    const sc = new Scanner(line);
    const firstGroup = parseNodeGroup(sc);
    if (!firstGroup) {
      issues.add(`Could not parse flowchart line: ${line.slice(0, 80)}`);
      continue;
    }
    let prev = firstGroup.map(touch).filter((n): n is FNode => !!n);
    let ok = true;
    while (!sc.done()) {
      const link = parseLink(sc);
      const next = link ? parseNodeGroup(sc) : null;
      if (!link || !next) {
        ok = false;
        break;
      }
      const nextNodes = next.map(touch).filter((n): n is FNode => !!n);
      for (const a of prev) {
        for (const b of nextNodes) {
          if (edges.length >= MAX_MERMAID_EDGES) {
            issues.add(`Too many edges; only the first ${MAX_MERMAID_EDGES} were imported`);
            break;
          }
          edges.push({ from: a.id, to: b.id, ...link });
        }
      }
      prev = nextNodes;
    }
    if (!ok) issues.add(`Could not parse flowchart line: ${line.slice(0, 80)}`);
  }
  if (stack.length > 0) issues.add('Unclosed subgraph');

  // Build node elements with sizes that fit their labels.
  const elements = new Map<string, NodeElement>();
  for (const n of nodes.values()) {
    const style: Style = {};
    for (const c of n.classes) Object.assign(style, classDefs.get(c) ?? {});
    Object.assign(style, nodeStyles.get(n.id) ?? {});
    const base = createNode(n.shape);
    const size = sizeFor(n.shape, n.label, base);
    elements.set(
      n.id,
      createNode(n.shape, {
        label: n.label,
        ...size,
        flipX: n.flipX,
        ...(n.strokeWidth ? { strokeWidth: n.strokeWidth } : {}),
        ...(style.fill ? { backgroundColor: style.fill } : {}),
        ...(style.stroke ? { strokeColor: style.stroke } : {}),
        ...(style.strokeWidth ? { strokeWidth: style.strokeWidth } : {}),
        ...(style.dashed ? { strokeStyle: 'dashed' as const } : {}),
        metadata: { mermaidId: n.id.slice(0, 100) },
      }),
    );
  }

  // Clustered layout: every subgraph is laid out on its own and then placed as one block.
  const PAD = 30;
  const TITLE = 24;
  const groupOf = (id: string) => nodes.get(id)?.group ?? null;
  const chain = (id: string): (string | null)[] => {
    const out: (string | null)[] = [];
    let g = groupOf(id);
    while (g) {
      out.unshift(g);
      g = groups.get(g)?.parent ?? null;
    }
    return [null, ...out];
  };
  const layoutGroup = (gid: string | null, dir: LayoutDirection): { positions: Map<string, { x: number; y: number }>; width: number; height: number } => {
    const members: NodeElement[] = [];
    const proxies = new Map<string, { el: NodeElement; inner: ReturnType<typeof layoutGroup> }>();
    for (const n of nodes.values()) if (n.group === gid) members.push(elements.get(n.id)!);
    for (const g of groups.values()) {
      if (g.parent !== gid) continue;
      const inner = layoutGroup(g.id, g.direction ?? dir);
      const proxy = createNode('rectangle', { width: inner.width + PAD * 2, height: inner.height + PAD * 2 + TITLE });
      proxies.set(g.id, { el: proxy, inner });
      members.push(proxy);
    }
    const repOf = (nodeId: string): string | null => {
      const c = chain(nodeId);
      const at = c.indexOf(gid);
      if (at < 0) return null;
      const next = c[at + 1];
      return next ? proxies.get(next)!.el.id : elements.get(nodeId)!.id;
    };
    const layoutEdges = edges.flatMap((e) => {
      const a = repOf(e.from);
      const b = repOf(e.to);
      return a && b && a !== b ? [layoutEdge(a, b)] : [];
    });
    const pos = autoLayout(members, layoutEdges, 'hierarchical', { direction: dir, nodeSpacing: 50, rankSpacing: 60 });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of members) {
      const p = pos.get(el.id)!;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + el.width);
      maxY = Math.max(maxY, p.y + el.height);
    }
    const positions = new Map<string, { x: number; y: number }>();
    for (const el of members) {
      const p = pos.get(el.id)!;
      positions.set(el.id, { x: p.x - minX, y: p.y - minY });
    }
    for (const { el, inner } of proxies.values()) {
      const p = positions.get(el.id)!;
      positions.delete(el.id);
      for (const [id, q] of inner.positions) positions.set(id, { x: p.x + PAD + q.x, y: p.y + TITLE + PAD + q.y });
    }
    return { positions, width: members.length ? maxX - minX : 0, height: members.length ? maxY - minY : 0 };
  };
  const layout = layoutGroup(null, direction);

  const b = new DiagramBuilder();
  const placed = new Map<string, SceneElement>();
  for (const [mid, el] of elements) {
    const p = layout.positions.get(el.id) ?? { x: 0, y: 0 };
    placed.set(mid, b.add({ ...el, x: p.x, y: p.y }));
  }
  for (const e of edges) {
    if (e.invisible) continue;
    const from = placed.get(e.from);
    const to = placed.get(e.to);
    if (!from || !to) continue;
    b.connect(from, to, {
      routing: 'orthogonal',
      startArrowhead: e.start,
      endArrowhead: e.end,
      strokeStyle: e.style,
      strokeWidth: e.thick ? 3 : 1.5,
      ...(e.label ? { label: e.label } : {}),
      ...(from.id === to.id ? { fromPort: 'right', toPort: 'bottom' } : {}),
    });
  }
  // Frame rectangles: direct nodes plus child frames (with their title strip), padded.
  const rects = new Map<string, { minX: number; minY: number; maxX: number; maxY: number } | null>();
  const frameRect = (gid: string): { minX: number; minY: number; maxX: number; maxY: number } | null => {
    if (rects.has(gid)) return rects.get(gid)!;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const grow = (x0: number, y0: number, x1: number, y1: number) => {
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    };
    for (const n of nodes.values()) {
      if (n.group !== gid) continue;
      const el = placed.get(n.id)!;
      grow(el.x, el.y, el.x + el.width, el.y + el.height);
    }
    for (const child of groups.values()) {
      if (child.parent !== gid) continue;
      const c = frameRect(child.id);
      if (c) grow(c.minX, c.minY - TITLE, c.maxX, c.maxY);
    }
    const out = minX <= maxX ? { minX: minX - PAD, minY: minY - PAD, maxX: maxX + PAD, maxY: maxY + PAD } : null;
    rects.set(gid, out);
    return out;
  };
  for (const g of groups.values()) {
    const r = frameRect(g.id);
    if (!r) continue;
    const frame = b.frameRect(g.title || g.id, r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
    // Frames never nest: nodes belong to their innermost subgraph's frame.
    b.adopt(
      frame,
      [...nodes.values()].filter((n) => n.group === g.id).map((n) => placed.get(n.id)!),
    );
  }
  return { elements: b.finish(), issues: issues.list() };
}
