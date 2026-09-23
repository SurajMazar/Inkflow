import { generateId, randomInteger } from '@inkflow/shared';
import { DEFAULT_ELEMENT_STYLE, DEFAULT_TEXT_STYLE, DEFAULT_BINDING_GAP } from './constants';
import type {
  BaseElement,
  Binding,
  EdgeLabel,
  ElementOfType,
  ElementType,
  Port,
  SceneElement,
  ShapeLabel,
  TableColumn,
  TextStyle,
} from './types';

export type NewElementProps<T extends ElementType> = Partial<Omit<ElementOfType<T>, 'type'>>;

function baseDefaults(type: ElementType): BaseElement {
  return {
    id: generateId(),
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: DEFAULT_ELEMENT_STYLE.strokeColor,
    backgroundColor: DEFAULT_ELEMENT_STYLE.backgroundColor,
    strokeWidth: DEFAULT_ELEMENT_STYLE.strokeWidth,
    strokeStyle: DEFAULT_ELEMENT_STYLE.strokeStyle,
    fillStyle: DEFAULT_ELEMENT_STYLE.fillStyle,
    opacity: DEFAULT_ELEMENT_STYLE.opacity,
    roughness: DEFAULT_ELEMENT_STYLE.roughness,
    roundness: 'sharp',
    locked: false,
    hidden: false,
    groupIds: [],
    frameId: null,
    index: 'a0',
    version: 1,
    versionNonce: randomInteger(),
    seed: randomInteger(),
    isDeleted: false,
    updated: Date.now(),
    flipX: false,
    flipY: false,
    link: null,
    customData: null,
  };
}

export function createLabel(
  text: string,
  style: Partial<TextStyle> & { color?: string | null } = {},
): ShapeLabel {
  return {
    ...DEFAULT_TEXT_STYLE,
    textAlign: 'center',
    verticalAlign: 'middle',
    ...style,
    color: style.color ?? null,
    text,
  };
}

export function createEdgeLabel(
  text: string,
  style: Partial<TextStyle> & { color?: string | null; position?: number } = {},
): EdgeLabel {
  return {
    ...DEFAULT_TEXT_STYLE,
    fontSize: 16,
    textAlign: 'center',
    verticalAlign: 'middle',
    ...style,
    color: style.color ?? null,
    position: style.position ?? 0.5,
    text,
  };
}

export function createBinding(
  elementId: string,
  options: Partial<Omit<Binding, 'elementId'>> = {},
): Binding {
  return { elementId, portId: null, anchor: null, gap: DEFAULT_BINDING_GAP, ...options };
}

export function createTableColumn(
  name: string,
  options: Partial<Omit<TableColumn, 'name'>> = {},
): TableColumn {
  return {
    id: generateId(10),
    name,
    dataType: 'text',
    primaryKey: false,
    foreignKey: false,
    nullable: true,
    unique: false,
    references: null,
    ...options,
  };
}

export const DEFAULT_PORTS: readonly Port[] = Object.freeze([
  { id: 'top', side: 'top', offset: 0.5 },
  { id: 'right', side: 'right', offset: 0.5 },
  { id: 'bottom', side: 'bottom', offset: 0.5 },
  { id: 'left', side: 'left', offset: 0.5 },
]) as readonly Port[];

function typeDefaults(type: ElementType): Record<string, unknown> {
  switch (type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'triangle':
      return { label: null };
    case 'polygon':
      return { label: null, sides: 6 };
    case 'star':
      return { label: null, spikes: 5, innerRatio: 0.45 };
    case 'line':
      return {
        points: [[0, 0]],
        startArrowhead: 'none',
        endArrowhead: 'none',
        startBinding: null,
        endBinding: null,
        label: null,
        pathStyle: 'sharp',
        closed: false,
      };
    case 'arrow':
      return {
        points: [[0, 0]],
        startArrowhead: 'none',
        endArrowhead: 'arrow',
        startBinding: null,
        endBinding: null,
        label: null,
        pathStyle: 'sharp',
      };
    case 'connector':
      return {
        points: [[0, 0]],
        startArrowhead: 'none',
        endArrowhead: 'triangle',
        startBinding: null,
        endBinding: null,
        label: null,
        routing: 'orthogonal',
        edgeKind: 'flow',
        waypoints: [],
        roughness: 0,
      };
    case 'freedraw':
      return { points: [[0, 0, 0.5]], brush: 'pencil', simulatePressure: true, fillStyle: 'solid' };
    case 'text':
      return { ...DEFAULT_TEXT_STYLE, text: '', autoResize: true };
    case 'image':
      return {
        fileId: null,
        status: 'pending',
        naturalWidth: 0,
        naturalHeight: 0,
        crop: null,
        lockAspectRatio: true,
        strokeColor: 'transparent',
      };
    case 'frame':
      return { name: 'Frame', clip: true, roughness: 0, strokeWidth: 1, strokeColor: '#bbbbbb' };
    case 'node':
      return {
        shape: 'rectangle',
        label: null,
        icon: null,
        metadata: {},
        ports: null,
        customPath: null,
        roughness: 0,
        roundness: 'round',
        backgroundColor: '#ffffff',
      };
    case 'table':
      return {
        name: 'table',
        columns: [],
        fontFamily: 'mono',
        fontSize: 14,
        headerColor: '#e7f5ff',
        roughness: 0,
        backgroundColor: '#ffffff',
        strokeWidth: 1,
      };
    case 'uml-class':
      return {
        name: 'Class',
        stereotype: null,
        attributes: [],
        methods: [],
        isAbstract: false,
        fontFamily: 'sans',
        fontSize: 14,
        roughness: 0,
        backgroundColor: '#ffffff',
        strokeWidth: 1,
      };
    case 'sequence':
      return {
        participants: [],
        messages: [],
        notes: [],
        fontFamily: 'sans',
        fontSize: 14,
        participantSpacing: 180,
        messageSpacing: 48,
        roughness: 0,
        strokeWidth: 1,
      };
  }
}

/** Creates a fully populated element of the given type with sensible defaults. */
export function createElement<T extends ElementType>(
  type: T,
  props: NewElementProps<T> = {},
): ElementOfType<T> {
  const element = {
    ...baseDefaults(type),
    ...typeDefaults(type),
    ...props,
    type,
  } as unknown as ElementOfType<T>;
  return element;
}

/** Deep clone of an element (elements are plain JSON). */
export function cloneElement<T extends SceneElement>(el: T): T {
  return structuredClone(el);
}

/** Returns a copy with a new version, nonce and timestamp. */
export function bumpVersion<T extends SceneElement>(el: T, now = Date.now()): T {
  return { ...el, version: el.version + 1, versionNonce: randomInteger(), updated: now };
}
