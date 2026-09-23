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
  /**
   * Closed shapes filled with the stroke color and never stroked separately (bullseye centre of a
   * final state, status LEDs). Drawn after `details`.
   */
  fills?: Path[];
  /**
   * Outline used for connector attachment, port projection and selection highlights when the
   * drawn `outline` does not cover the node box (stick-figure actors, person silhouettes with a
   * label underneath, padlocks). Defaults to `outline`.
   */
  connectionOutline?: Path;
  /** Secondary text area (org-chart subtitle). Renderers draw `node.metadata.subtitle` there. */
  subtitleBox?: Rect;
  /** Mirrors `NodeShapeDefinition.elliptical` for consumers that only see the geometry. */
  elliptical?: boolean;
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
  /**
   * Tree layouts only: lay out the root's subtrees on both sides (mind map). Defaults to true for
   * direction `LR` and false otherwise.
   */
  mindMap?: boolean;
  /** Force layouts only: number of simulation iterations (default depends on graph size). */
  iterations?: number;
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
  rows: { columnId: string; y: number; height: number; badge: string }[];
  /** Horizontal padding inside cells and font metrics used for measuring. */
  padding: number;
  fontSize: number;
  headerFontSize: number;
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
  /** Lines of the name compartment (optional «stereotype» line first, then the name). */
  nameLines: { text: string; y: number; bold: boolean; italic: boolean }[];
  attributeLines: { text: string; y: number; underline: boolean }[];
  methodLines: { text: string; y: number; underline: boolean; italic: boolean }[];
  paddingX: number;
  fontSize: number;
}

export interface SequenceLayout {
  width: number;
  height: number;
  headerHeight: number;
  participants: {
    id: string;
    centerX: number;
    headerX: number;
    headerWidth: number;
    /** Top of the participant header (0, or the y of the `create` message that creates it). */
    headerY: number;
    headerHeight: number;
    kind: 'participant' | 'actor' | 'database' | 'boundary' | 'control' | 'entity';
    name: string;
    /** Lifeline extent for this participant (ends early at a `destroy` message). */
    lifelineTop: number;
    lifelineBottom: number;
    destroyed: boolean;
  }[];
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
    from: string;
    to: string;
    /** Self messages: loop height (the arrow returns at `y + loopHeight`) and loop width. */
    loopHeight: number;
    loopWidth: number;
    /** Label anchor (centre of the label's baseline box) and measured width. */
    labelX: number;
    labelY: number;
    labelWidth: number;
  }[];
  /** `x` is the left edge of the activation bar; `width` is ACTIVATION_WIDTH. */
  activations: { participantId: string; x: number; width: number; top: number; bottom: number; depth: number }[];
  notes: { id: string; x: number; y: number; width: number; height: number; text: string; lines: string[] }[];
  /** Font metrics used for labels (so renderers draw exactly what was measured). */
  fontSize: number;
  lineHeight: number;
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
