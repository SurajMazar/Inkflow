/**
 * Public contracts of the diagram engine (shape registry, icons, ports, layouts, library,
 * templates). Implementations live alongside; keep this file free of implementation.
 */
import type {
  NodeElement,
  Port,
  PortSide,
  SceneElement,
} from '@inkflow/elements';
import type { Path, Point, Rect } from '@inkflow/geometry';
import type { DocumentAppState } from '@inkflow/scene';
import type { TemplateCategory } from '@inkflow/shared';

export type ShapeCategory =
  | 'basic'
  | 'flowchart'
  | 'uml'
  | 'infrastructure'
  | 'cloud'
  | 'network'
  | 'people'
  | 'misc';

/** Geometry of a node shape in local coordinates (0..width, 0..height). */
export interface ShapeGeometry {
  /** Closed outline: filled, stroked, hit-tested and used for floating connection attachment. */
  outline: Path;
  /** Extra strokes drawn on top of the fill and never filled (cylinder rim, page fold…). */
  details?: Path[];
  /** Area in which the label is laid out. Defaults to the full box minus padding. */
  labelBox?: Rect;
  /** Area in which the icon is drawn, if the shape reserves one. */
  iconBox?: Rect;
}

export interface NodeShapeDefinition {
  key: string;
  label: string;
  category: ShapeCategory;
  keywords: string[];
  defaultSize: { width: number; height: number };
  defaultStyle?: Partial<Pick<NodeElement, 'backgroundColor' | 'strokeColor' | 'roundness' | 'fillStyle'>>;
  defaultIcon?: string | null;
  /** Elliptical outlines attach connectors along the ellipse instead of the polygon. */
  elliptical?: boolean;
  geometry(width: number, height: number, element?: NodeElement): ShapeGeometry;
  /** Default ports; falls back to the four side midpoints. */
  ports?(width: number, height: number): Port[];
}

export interface IconDefinition {
  key: string;
  label: string;
  category: string;
  keywords: string[];
  /** Stroke-based SVG path data in a 24×24 box (Lucide-style, 2px stroke, round caps). */
  paths: string[];
  /** Optional filled path data in the same box. */
  fills?: string[];
}

export interface ResolvedPort {
  id: string;
  side: PortSide;
  /** World position (rotation applied). */
  point: Point;
  /** Unit outward normal in world space. */
  normal: Point;
}

export interface BindingCandidate {
  element: SceneElement;
  portId: string | null;
  /** Normalized anchor within the target box when not bound to a named port. */
  anchor: [number, number] | null;
  /** World point the endpoint will attach to. */
  point: Point;
}

export type AutoLayoutKind = 'hierarchical' | 'tree' | 'grid' | 'horizontal' | 'vertical' | 'force';
export type LayoutDirection = 'TB' | 'BT' | 'LR' | 'RL';

export interface AutoLayoutOptions {
  direction?: LayoutDirection;
  /** Gap between sibling nodes. */
  nodeSpacing?: number;
  /** Gap between ranks/levels. */
  rankSpacing?: number;
  /** Deterministic seed for force layouts. */
  seed?: number;
}

export interface TableLayout {
  width: number;
  height: number;
  headerHeight: number;
  rowHeight: number;
  /** Key badge column (PK/FK) width, then name column, then type column. */
  keyColumnWidth: number;
  nameColumnX: number;
  typeColumnX: number;
  rows: { columnId: string; y: number; height: number }[];
}

export interface UmlClassLayout {
  width: number;
  height: number;
  lineHeight: number;
  nameHeight: number;
  attributesY: number;
  attributesHeight: number;
  methodsY: number;
  methodsHeight: number;
}

export interface SequenceLayout {
  width: number;
  height: number;
  headerHeight: number;
  participants: { id: string; centerX: number; headerX: number; headerWidth: number }[];
  lifelineTop: number;
  lifelineBottom: number;
  messages: {
    id: string;
    y: number;
    fromX: number;
    toX: number;
    self: boolean;
    kind: 'sync' | 'async' | 'return' | 'create' | 'destroy';
    label: string;
  }[];
  activations: { participantId: string; x: number; top: number; bottom: number; depth: number }[];
  notes: { id: string; x: number; y: number; width: number; height: number; text: string }[];
}

export type LibraryCategory =
  | 'basic'
  | 'flowchart'
  | 'infrastructure'
  | 'network'
  | 'cloud'
  | 'software'
  | 'data'
  | 'people'
  | 'uml'
  | 'er';

/** Reusable symbol in the diagram library panel. */
export interface LibraryItem {
  id: string;
  name: string;
  category: LibraryCategory;
  keywords: string[];
  /** Creates fresh elements (new ids, index 'a0' placeholder) centered at `center`. */
  create(center: Point): SceneElement[];
}

export interface TemplateContent {
  elements: SceneElement[];
  appState?: Partial<DocumentAppState>;
}

export interface TemplateDefinition {
  key: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Builds fresh, fully editable elements with valid fractional indices. */
  build(): TemplateContent;
}
