import type {
  ConnectorElement,
  ElementType,
  FrameElement,
  FreedrawElement,
  ImageElement,
  LinearElement,
  NodeElement,
  SceneElement,
  ShapeElement,
  ShapeLabel,
  TableElement,
  TextElement,
  UmlClassElement,
  SequenceElement,
} from './types';

export const SHAPE_TYPES = [
  'rectangle',
  'ellipse',
  'diamond',
  'triangle',
  'polygon',
  'star',
] as const;
export const LINEAR_TYPES = ['line', 'arrow', 'connector'] as const;
export const BINDABLE_TYPES: readonly ElementType[] = [
  ...SHAPE_TYPES,
  'text',
  'image',
  'node',
  'table',
  'uml-class',
  'frame',
];

export const isShapeElement = (el: SceneElement): el is ShapeElement =>
  (SHAPE_TYPES as readonly string[]).includes(el.type);
export const isLinearElement = (el: SceneElement): el is LinearElement =>
  el.type === 'line' || el.type === 'arrow' || el.type === 'connector';
export const isConnector = (el: SceneElement): el is ConnectorElement => el.type === 'connector';
export const isFreedraw = (el: SceneElement): el is FreedrawElement => el.type === 'freedraw';
export const isTextElement = (el: SceneElement): el is TextElement => el.type === 'text';
export const isImageElement = (el: SceneElement): el is ImageElement => el.type === 'image';
export const isFrameElement = (el: SceneElement): el is FrameElement => el.type === 'frame';
export const isNodeElement = (el: SceneElement): el is NodeElement => el.type === 'node';
export const isTableElement = (el: SceneElement): el is TableElement => el.type === 'table';
export const isUmlClassElement = (el: SceneElement): el is UmlClassElement =>
  el.type === 'uml-class';
export const isSequenceElement = (el: SceneElement): el is SequenceElement =>
  el.type === 'sequence';

/** Elements whose endpoints can attach to other elements. */
export const isBindingElement = (
  el: SceneElement,
): el is Extract<LinearElement, { type: 'arrow' | 'connector' }> =>
  el.type === 'arrow' || el.type === 'connector';

/** Elements that connectors and arrows can attach to. */
export const isBindableElement = (el: SceneElement): boolean => BINDABLE_TYPES.includes(el.type);

export type LabelledElement = ShapeElement | NodeElement;

/** Elements that carry an embedded, centered shape label. */
export const hasShapeLabel = (el: SceneElement): el is LabelledElement =>
  isShapeElement(el) || el.type === 'node';

export function getShapeLabel(el: SceneElement): ShapeLabel | null {
  return hasShapeLabel(el) ? el.label : null;
}

/** Elements that are always rendered as filled boxes and hit-tested by area. */
export const isBoxLikeElement = (el: SceneElement): boolean =>
  el.type === 'text' ||
  el.type === 'image' ||
  el.type === 'node' ||
  el.type === 'table' ||
  el.type === 'uml-class' ||
  el.type === 'sequence';

/** Elements whose resize should keep their aspect ratio by default. */
export const prefersAspectRatio = (el: SceneElement): boolean =>
  (el.type === 'image' && el.lockAspectRatio) || el.type === 'text';
