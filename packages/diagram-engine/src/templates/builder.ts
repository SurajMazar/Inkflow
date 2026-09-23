import {
  createElement,
  getCommonBounds,
  isLinearElement,
  measureTextElement,
  type ConnectorElement,
  type FrameElement,
  type NodeElement,
  type SceneElement,
  type TextElement,
} from '@inkflow/elements';
import type { Point } from '@inkflow/geometry';
import { generateNKeysBetween, type DocumentAppState } from '@inkflow/scene';
import { generateId } from '@inkflow/shared';
import { createConnector, createNode, facingPort, type ConnectorProps, type NodeProps } from '../builders';
import { autoLayout } from '../layout';
import { CONTAINER_SHAPE_KEYS } from '../shapes/catalog';
import { computeConnectorRoute } from '../routing/route';
import type { AutoLayoutKind, AutoLayoutOptions, TemplateContent } from '../types';


export interface TextOptions {
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  color?: string;
  align?: 'left' | 'center' | 'right';
  width?: number;
}

/** Palette used by templates (Open Color derived, matches the style panel). */
export const PALETTE = {
  blue: { bg: '#e7f5ff', stroke: '#1971c2' },
  green: { bg: '#ebfbee', stroke: '#2f9e44' },
  orange: { bg: '#fff4e6', stroke: '#e8590c' },
  violet: { bg: '#f3f0ff', stroke: '#6741d9' },
  red: { bg: '#fff5f5', stroke: '#e03131' },
  yellow: { bg: '#fff9db', stroke: '#f08c00' },
  teal: { bg: '#e6fcf5', stroke: '#099268' },
  gray: { bg: '#f8f9fa', stroke: '#495057' },
  grape: { bg: '#f8f0fc', stroke: '#9c36b5' },
  cyan: { bg: '#e3fafc', stroke: '#0c8599' },
} as const;
export type PaletteColor = keyof typeof PALETTE;

/**
 * Imperative helper to assemble diagrams from real, editable elements. `build()` routes every
 * connector around the placed nodes, assigns frame membership and emits elements in z-order
 * (frames, containers, nodes, connectors, text) with fresh ascending fractional indices.
 */
export class DiagramBuilder {
  private readonly items: SceneElement[] = [];
  /** Connector ends whose port was chosen automatically (re-evaluated after layout in `finish`). */
  private readonly autoPorts = new Map<string, { start: boolean; end: boolean }>();

  get elements(): readonly SceneElement[] {
    return this.items;
  }

  add<T extends SceneElement>(el: T): T {
    this.items.push(el);
    return el;
  }

  /** Node with its top-left at (x, y). */
  node(shape: string, x: number, y: number, label: string | null, props: NodeProps & { color?: PaletteColor } = {}): NodeElement {
    const { color, ...rest } = props;
    const colors = color ? { backgroundColor: PALETTE[color].bg, strokeColor: PALETTE[color].stroke } : {};
    return this.add(createNode(shape, { ...colors, ...rest, x, y, label: label ?? undefined }));
  }

  /** Node centred on (cx, cy). */
  nodeAt(shape: string, cx: number, cy: number, label: string | null, props: NodeProps & { color?: PaletteColor } = {}): NodeElement {
    const probe = createNode(shape, { width: props.width, height: props.height });
    return this.node(shape, cx - probe.width / 2, cy - probe.height / 2, label, { ...props, width: probe.width, height: probe.height });
  }

  connect(from: SceneElement, to: SceneElement, props: ConnectorProps = {}): ConnectorElement {
    const c = this.add(createConnector(from, to, { strokeWidth: 1.5, ...props }));
    this.autoPorts.set(c.id, { start: props.fromPort === undefined, end: props.toPort === undefined });
    return c;
  }

  text(x: number, y: number, text: string, options: TextOptions = {}): TextElement {
    const base = createElement('text', {
      x,
      y,
      text,
      fontFamily: 'sans',
      fontSize: options.fontSize ?? 20,
      fontWeight: options.fontWeight ?? 'normal',
      textAlign: options.align ?? 'left',
      strokeColor: options.color ?? '#1e1e1e',
      roughness: 0,
      autoResize: options.width === undefined,
      width: options.width ?? 0,
    });
    const size = measureTextElement(base);
    return this.add({ ...base, width: size.width, height: size.height });
  }

  /** Frame around `children` (padding on every side); children get the frame id. */
  frame(name: string, children: readonly SceneElement[], padding = 40, props: Partial<FrameElement> = {}): FrameElement {
    const b = getCommonBounds(children);
    const frame = createElement('frame', {
      name,
      x: (b?.minX ?? 0) - padding,
      y: (b?.minY ?? 0) - padding,
      width: (b ? b.maxX - b.minX : 200) + padding * 2,
      height: (b ? b.maxY - b.minY : 200) + padding * 2,
      ...props,
    });
    this.add(frame);
    this.adopt(frame, children);
    return frame;
  }

  frameRect(name: string, x: number, y: number, width: number, height: number, props: Partial<FrameElement> = {}): FrameElement {
    return this.add(createElement('frame', { name, x, y, width, height, ...props }));
  }

  adopt(frame: FrameElement, children: readonly SceneElement[]): void {
    const ids = new Set(children.map((c) => c.id));
    for (let i = 0; i < this.items.length; i++) {
      const el = this.items[i]!;
      if (ids.has(el.id)) this.items[i] = { ...el, frameId: frame.id };
    }
  }

  /** Puts the given elements in one new group. */
  group(elements: readonly SceneElement[]): string {
    const gid = generateId();
    const ids = new Set(elements.map((e) => e.id));
    for (let i = 0; i < this.items.length; i++) {
      const el = this.items[i]!;
      if (ids.has(el.id)) this.items[i] = { ...el, groupIds: [...el.groupIds, gid] };
    }
    return gid;
  }

  get(id: string): SceneElement | undefined {
    return this.items.find((e) => e.id === id);
  }

  /** Re-positions `nodes` with an auto layout (edges = connectors between them), anchored at `origin`. */
  layout(nodes: readonly SceneElement[], kind: AutoLayoutKind, options: AutoLayoutOptions = {}, origin?: Point): void {
    const ids = new Set(nodes.map((n) => n.id));
    const current = this.items.filter((e) => ids.has(e.id));
    const edges = this.items.filter(
      (e): e is ConnectorElement => e.type === 'connector' && !!e.startBinding && !!e.endBinding && ids.has(e.startBinding.elementId) && ids.has(e.endBinding.elementId),
    );
    const pos = autoLayout(current, edges, kind, options);
    let dx = 0;
    let dy = 0;
    if (origin) {
      dx = origin.x - Math.min(...[...pos.values()].map((p) => p.x));
      dy = origin.y - Math.min(...[...pos.values()].map((p) => p.y));
    }
    for (let i = 0; i < this.items.length; i++) {
      const el = this.items[i]!;
      const p = pos.get(el.id);
      if (p) this.items[i] = { ...el, x: p.x + dx, y: p.y + dy };
    }
  }

  /** Moves every element (and connector waypoints) by (dx, dy). */
  translate(dx: number, dy: number): void {
    for (let i = 0; i < this.items.length; i++) {
      const el = this.items[i]!;
      const moved = { ...el, x: el.x + dx, y: el.y + dy };
      if (moved.type === 'connector') moved.waypoints = moved.waypoints.map(([x, y]) => [x + dx, y + dy]);
      this.items[i] = moved;
    }
  }

  /** Routes connectors, orders by layer and assigns fresh ascending fractional indices. */
  finish(): SceneElement[] {
    const obstacles = this.items.filter((e) => !isLinearElement(e) && e.type !== 'frame' && e.type !== 'text');
    const byId = new Map(this.items.map((e) => [e.id, e]));
    const get = (id: string) => byId.get(id);
    const repinned = this.items.map((el) => {
      const auto = this.autoPorts.get(el.id);
      if (el.type !== 'connector' || !auto || !el.startBinding || !el.endBinding) return el;
      const from = get(el.startBinding.elementId);
      const to = get(el.endBinding.elementId);
      if (!from || !to) return el;
      return {
        ...el,
        startBinding: auto.start ? { ...el.startBinding, portId: facingPort(from, to) } : el.startBinding,
        endBinding: auto.end ? { ...el.endBinding, portId: facingPort(to, from) } : el.endBinding,
      };
    });
    const routed = repinned.map((el) => (el.type === 'connector' ? { ...el, ...computeConnectorRoute(el, get, obstacles) } : el));
    const rank = (el: SceneElement) => {
      if (el.type === 'frame') return 0;
      if (el.type === 'node' && CONTAINER_SHAPE_KEYS.has(el.shape)) return 1;
      if (isLinearElement(el)) return 3;
      if (el.type === 'text') return 4;
      return 2;
    };
    const ordered = routed
      .map((el, i) => ({ el, i }))
      .sort((a, b) => rank(a.el) - rank(b.el) || a.i - b.i)
      .map((x) => x.el);
    const keys = generateNKeysBetween(null, null, ordered.length);
    return ordered.map((el, i) => ({ ...el, index: keys[i]! }));
  }

  build(appState: Partial<DocumentAppState> = {}): TemplateContent {
    return { elements: this.finish(), appState: { viewBackgroundColor: '#ffffff', gridType: 'dot', gridSize: 20, ...appState } };
  }
}

/** Translates freshly built elements so their common bounds are centred on `center`. */
export function centerElements(elements: SceneElement[], center: Point): SceneElement[] {
  const b = getCommonBounds(elements);
  if (!b) return elements;
  const dx = center.x - (b.minX + b.maxX) / 2;
  const dy = center.y - (b.minY + b.maxY) / 2;
  return elements.map((el) => {
    const moved = { ...el, x: el.x + dx, y: el.y + dy };
    if (moved.type === 'connector') moved.waypoints = moved.waypoints.map(([x, y]) => [x + dx, y + dy]);
    return moved;
  });
}

