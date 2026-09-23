import type { ToolType } from '@inkflow/canvas-engine';
import { isLinearElement, type ElementType, type SceneElement } from '@inkflow/elements';

export const MIXED = Symbol('mixed');
export type Maybe<T> = T | typeof MIXED;

const TEXT_KEYS = new Set([
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'textAlign',
  'verticalAlign',
  'lineHeight',
  'letterSpacing',
]);

/** Reads a style property, looking into embedded labels for text properties. */
export function readProp(el: SceneElement, key: string): unknown {
  const rec = el as unknown as Record<string, unknown>;
  if (TEXT_KEYS.has(key) && el.type !== 'text' && !(key in rec)) {
    const label = 'label' in el ? el.label : null;
    return label ? (label as unknown as Record<string, unknown>)[key] : undefined;
  }
  return rec[key];
}

/** Common value of a property across elements (MIXED when they differ, fallback when none has it). */
export function commonValue<T>(elements: readonly SceneElement[], key: string, fallback: T): Maybe<T> {
  let found = false;
  let value: unknown;
  for (const el of elements) {
    const v = readProp(el, key);
    if (v === undefined) continue;
    if (!found) {
      found = true;
      value = v;
    } else if (JSON.stringify(v) !== JSON.stringify(value)) {
      return MIXED;
    }
  }
  return found ? (value as T) : fallback;
}

/** Element type created by a tool (for showing default-style controls with no selection). */
export const TOOL_ELEMENT: Partial<Record<ToolType, ElementType>> = {
  rectangle: 'rectangle',
  roundedRectangle: 'rectangle',
  ellipse: 'ellipse',
  diamond: 'diamond',
  triangle: 'triangle',
  polygon: 'polygon',
  star: 'star',
  line: 'line',
  arrow: 'arrow',
  connector: 'connector',
  pencil: 'freedraw',
  brush: 'freedraw',
  highlighter: 'freedraw',
  text: 'text',
  frame: 'frame',
  node: 'node',
};

const SHAPES: ElementType[] = ['rectangle', 'ellipse', 'diamond', 'triangle', 'polygon', 'star'];
const LINEAR: ElementType[] = ['line', 'arrow', 'connector'];

export interface Capabilities {
  stroke: boolean;
  background: boolean;
  fill: boolean;
  strokeWidth: boolean;
  strokeStyle: boolean;
  roughness: boolean;
  roundness: boolean;
  text: boolean;
  textFull: boolean;
  arrowheads: boolean;
  pathStyle: boolean;
  routing: boolean;
  opacity: boolean;
}

export function capabilitiesFor(types: readonly ElementType[], elements: readonly SceneElement[]): Capabilities {
  const any = (list: ElementType[]) => types.some((t) => list.includes(t));
  const closedLine = elements.some((e) => e.type === 'line' && e.closed);
  const labelled = elements.some((e) => 'label' in e && e.label && !isLinearElement(e));
  return {
    stroke: types.some((t) => t !== 'image'),
    background: any([...SHAPES, 'node', 'text', 'frame', 'table', 'uml-class', 'sequence']) || closedLine,
    fill: any([...SHAPES, 'node']) || closedLine,
    strokeWidth: any([...SHAPES, ...LINEAR, 'freedraw', 'node', 'table', 'uml-class', 'sequence']),
    strokeStyle: any([...SHAPES, ...LINEAR, 'node', 'table', 'uml-class']),
    roughness: any([...SHAPES, ...LINEAR, 'node']),
    roundness: any(['rectangle', 'diamond', 'polygon', 'node', 'connector', 'triangle']),
    text: any(['text', 'table', 'uml-class', 'sequence', ...SHAPES, 'node']) || labelled,
    textFull: any(['text', ...SHAPES, 'node']) || labelled,
    arrowheads: any(LINEAR),
    pathStyle: any(['arrow', 'line']),
    routing: any(['connector']),
    opacity: types.length > 0,
  };
}
