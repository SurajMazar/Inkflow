import {
  createBinding,
  createElement,
  createLabel,
  createTableColumn,
  getElementBounds,
  getElementCenter,
  type Arrowhead,
  type ConnectorElement,
  type EdgeKind,
  type NodeElement,
  type SceneElement,
  type SequenceElement,
  type SequenceMessageKind,
  type SequenceParticipantKind,
  type TableColumn,
  type TableElement,
  type UmlClassElement,
  createEdgeLabel,
  type ShapeLabel,
  type EdgeLabel,
} from '@inkflow/elements';
import { generateId } from '@inkflow/shared';
import { measureSequence } from './layouts/sequence';
import { measureTable } from './layouts/table';
import { measureUmlClass } from './layouts/uml-class';
import { getElementPorts } from './ports';
import { computeConnectorRoute } from './routing/route';
import { shapeRegistry } from './shapes/registry';

/** Label style used by diagram builders (clean sans text). */
export const DIAGRAM_LABEL_STYLE = { fontFamily: 'sans', fontSize: 16 } as const;

export type NodeProps = Partial<Omit<NodeElement, 'label' | 'type'>> & { label?: string | ShapeLabel | null };

/**
 * Creates a semantic node for a registered shape (unknown shapes fall back to `rectangle`), sized
 * and styled from the shape defaults. `label` may be a plain string.
 */
export function createNode(shape: string, props: NodeProps = {}): NodeElement {
  const def = shapeRegistry.get(shape) ?? shapeRegistry.get('rectangle')!;
  const { label, ...given } = props;
  const rest = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)) as Partial<NodeElement>;
  const style = def.defaultStyle ?? {};
  const node = createElement('node', {
    width: def.defaultSize.width,
    height: def.defaultSize.height,
    icon: def.defaultIcon ?? null,
    ...style,
    ...rest,
    shape: shape === 'custom' || shapeRegistry.has(shape) ? shape : 'rectangle',
    label:
      label === undefined || label === null
        ? null
        : typeof label === 'string'
          ? createLabel(label, { ...DIAGRAM_LABEL_STYLE, fontSize: labelSizeFor(def.defaultSize.height) })
          : label,
  });
  return node;
}

function labelSizeFor(height: number): number {
  return height < 40 ? 14 : 16;
}

/**
 * Side port of `el` facing `toward`. With an element, the axis is chosen by the larger gap
 * between the two boxes (horizontal when they are side by side, vertical when stacked); with a
 * point, by the dominant direction relative to the element's aspect ratio.
 */
export function facingPort(el: SceneElement, toward: SceneElement | { x: number; y: number }): string | null {
  const ports = getElementPorts(el).filter((p) => ['top', 'right', 'bottom', 'left'].includes(p.id));
  if (ports.length === 0) return null;
  const c = getElementCenter(el);
  let dir: { x: number; y: number };
  if ('type' in toward) {
    const a = getElementBounds(el);
    const b = getElementBounds(toward);
    const oc = getElementCenter(toward);
    const gx = Math.max(b.minX - a.maxX, a.minX - b.maxX);
    const gy = Math.max(b.minY - a.maxY, a.minY - b.maxY);
    dir = gx >= gy ? { x: Math.sign(oc.x - c.x) || 1, y: 0 } : { x: 0, y: Math.sign(oc.y - c.y) || 1 };
  } else {
    dir = { x: (toward.x - c.x) / Math.max(el.width, 1), y: (toward.y - c.y) / Math.max(el.height, 1) };
  }
  let best = ports[0]!;
  let bestScore = -Infinity;
  for (const p of ports) {
    const score = p.normal.x * dir.x + p.normal.y * dir.y;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = p;
    }
  }
  return best.id;
}

export type ConnectorProps = Partial<Omit<ConnectorElement, 'label'>> & {
  label?: string | EdgeLabel | null;
  fromPort?: string | null;
  toPort?: string | null;
};

const lookup = (els: readonly (SceneElement | null)[]) => (id: string) => els.find((e) => e?.id === id) ?? undefined;

/**
 * Creates a connector bound to `from` / `to`. Ports default to the side ports facing each other;
 * pass `fromPort: null` / `toPort: null` for floating attachment. When both ends exist the points
 * come from `computeConnectorRoute` (no obstacles; re-route with obstacles after placement).
 */
export function createConnector(
  from: SceneElement | null,
  to: SceneElement | null,
  props: ConnectorProps = {},
): ConnectorElement {
  const { label, fromPort, toPort, ...rest } = props;
  const startBinding = from
    ? createBinding(from.id, { portId: fromPort === undefined ? (to ? facingPort(from, to) : null) : fromPort })
    : (rest.startBinding ?? null);
  const endBinding = to
    ? createBinding(to.id, { portId: toPort === undefined ? (from ? facingPort(to, from) : null) : toPort })
    : (rest.endBinding ?? null);
  let connector = createElement('connector', {
    points: [
      [0, 0],
      [120, 0],
    ],
    width: 120,
    ...rest,
    startBinding,
    endBinding,
    label: label === undefined || label === null ? null : typeof label === 'string' ? createEdgeLabel(label, { fontFamily: 'sans', fontSize: 14 }) : label,
  });
  if (from || to) {
    const route = computeConnectorRoute(connector, lookup([from, to]), []);
    connector = { ...connector, ...route };
  }
  return connector;
}

/** ER entity sized to fit its columns. */
export function createErTable(
  name: string,
  columns: Array<Partial<TableColumn> & { name: string }>,
  props: Partial<TableElement> = {},
): TableElement {
  const cols = columns.map(({ name: colName, ...opts }) =>
    createTableColumn(colName, { ...opts, nullable: opts.nullable ?? !(opts.primaryKey ?? false) }),
  );
  const table = createElement('table', { name, columns: cols, ...props });
  const size = measureTable(table);
  return { ...table, width: props.width ?? size.width, height: props.height ?? size.height };
}

export type ErCardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

const ER_HEADS: Record<ErCardinality, [Arrowhead, Arrowhead]> = {
  'one-to-one': ['er-one-only', 'er-one-only'],
  'one-to-many': ['er-one-only', 'er-zero-many'],
  'many-to-one': ['er-zero-many', 'er-one-only'],
  'many-to-many': ['er-zero-many', 'er-zero-many'],
};

/**
 * Relationship between two tables with crow's-foot arrowheads. Column ids bind to the row ports
 * (`col:<id>:left|right`, the side facing the other table); null binds to the facing side port.
 */
export function createErRelationship(
  from: TableElement,
  fromColumnId: string | null,
  to: TableElement,
  toColumnId: string | null,
  cardinality: ErCardinality,
  props: ConnectorProps = {},
): ConnectorElement {
  const fc = getElementCenter(from);
  const tc = getElementCenter(to);
  const toIsRight = tc.x >= fc.x;
  const horizontalGap = toIsRight ? to.x - (from.x + from.width) : from.x - (to.x + to.width);
  const colPort = (table: TableElement, colId: string | null, side: 'left' | 'right', other: TableElement) => {
    if (colId && table.columns.some((c) => c.id === colId)) return `col:${colId}:${side}`;
    return facingPort(table, other);
  };
  // Row ports sit on the left/right edges; when tables are stacked vertically use the same side
  // for both so the route forms a clean bracket.
  const stacked = horizontalGap < 40;
  const fromSide = stacked ? 'right' : toIsRight ? 'right' : 'left';
  const toSide = stacked ? 'right' : toIsRight ? 'left' : 'right';
  const [startArrowhead, endArrowhead] = ER_HEADS[cardinality];
  return createConnector(from, to, {
    routing: 'orthogonal',
    edgeKind: 'relationship',
    startArrowhead,
    endArrowhead,
    strokeWidth: 1.5,
    ...props,
    fromPort: colPort(from, fromColumnId, fromSide, to),
    toPort: colPort(to, toColumnId, toSide, from),
  });
}

/** UML class box sized to fit its compartments. */
export function createUmlClass(name: string, attributes: string[], methods: string[], props: Partial<UmlClassElement> = {}): UmlClassElement {
  const el = createElement('uml-class', { name, attributes, methods, ...props });
  const size = measureUmlClass(el);
  return { ...el, width: props.width ?? size.width, height: props.height ?? size.height };
}

export type UmlRelationKind = 'association' | 'dependency' | 'inheritance' | 'realization' | 'aggregation' | 'composition';

const UML_STYLE: Record<UmlRelationKind, { start: Arrowhead; end: Arrowhead; dashed: boolean; kind: EdgeKind }> = {
  association: { start: 'none', end: 'arrow', dashed: false, kind: 'association' },
  dependency: { start: 'none', end: 'arrow', dashed: true, kind: 'dependency' },
  inheritance: { start: 'none', end: 'triangle-outline', dashed: false, kind: 'inheritance' },
  realization: { start: 'none', end: 'triangle-outline', dashed: true, kind: 'realization' },
  aggregation: { start: 'diamond-outline', end: 'none', dashed: false, kind: 'aggregation' },
  composition: { start: 'diamond', end: 'none', dashed: false, kind: 'composition' },
};

/**
 * UML relationship with standard notation. Direction conventions: inheritance/realization point
 * from the subtype (`from`) to the supertype (`to`); aggregation/composition put the diamond on the
 * whole (`from`) and connect to the part (`to`); association/dependency point from client to supplier.
 */
export function createUmlRelation(from: SceneElement, to: SceneElement, kind: UmlRelationKind, props: ConnectorProps = {}): ConnectorElement {
  const s = UML_STYLE[kind];
  return createConnector(from, to, {
    routing: 'orthogonal',
    edgeKind: s.kind,
    startArrowhead: s.start,
    endArrowhead: s.end,
    strokeStyle: s.dashed ? 'dashed' : 'solid',
    strokeWidth: 1.5,
    ...props,
  });
}

/** Sequence diagram from participant names and index-based messages, sized with `measureSequence`. */
export function createSequenceDiagram(
  participants: Array<{ name: string; kind?: SequenceParticipantKind }>,
  messages: Array<{ from: number; to: number; label: string; kind?: SequenceMessageKind }>,
  props: Partial<SequenceElement> = {},
): SequenceElement {
  const parts = participants.map((p) => ({ id: generateId(10), name: p.name, kind: p.kind ?? 'participant' }));
  const msgs = messages
    .filter((m) => parts[m.from] && parts[m.to])
    .map((m) => ({ id: generateId(10), from: parts[m.from]!.id, to: parts[m.to]!.id, label: m.label, kind: m.kind ?? 'sync' }));
  const el = createElement('sequence', { participants: parts, messages: msgs, ...props });
  const size = measureSequence(el);
  return { ...el, width: Math.max(size.width, props.width ?? 0), height: Math.max(size.height, props.height ?? 0) };
}
