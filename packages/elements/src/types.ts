/**
 * Scene element model. Every persisted element shares `BaseElement`; each type adds its own
 * properties. Coordinates are world units. `x, y, width, height` describe the unrotated box;
 * `angle` (radians) rotates the element around the box center.
 */

export type FillStyle = 'hachure' | 'cross-hatch' | 'zigzag' | 'solid';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type Roundness = 'sharp' | 'round';
export type FontFamily = 'hand' | 'sans' | 'serif' | 'mono';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type FontWeight = 'normal' | 'bold';
export type FontStyle = 'normal' | 'italic';
export type TextDecoration = 'none' | 'underline' | 'line-through';

export type Arrowhead =
  | 'none'
  | 'arrow'
  | 'triangle'
  | 'triangle-outline'
  | 'dot'
  | 'circle-outline'
  | 'bar'
  | 'diamond'
  | 'diamond-outline'
  | 'er-one'
  | 'er-many'
  | 'er-one-only'
  | 'er-zero-one'
  | 'er-one-many'
  | 'er-zero-many';

export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'connector'
  | 'freedraw'
  | 'text'
  | 'image'
  | 'frame'
  | 'node'
  | 'table'
  | 'uml-class'
  | 'sequence';

/** A point relative to the element origin (x, y). */
export type LocalPoint = [number, number];
/** Freehand sample: relative x, y and pressure in [0, 1]. */
export type PressurePoint = [number, number, number];

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  fillStyle: FillStyle;
  /** 0–100 */
  opacity: number;
  /** 0 = architect (clean), 1 = artist, 2 = cartoonist. */
  roughness: number;
  roundness: Roundness;
  locked: boolean;
  hidden: boolean;
  /** Group membership, innermost group first and outermost last. */
  groupIds: string[];
  frameId: string | null;
  /** Fractional z-order key; the scene is ordered by (index, id). */
  index: string;
  /** Incremented on every change; used for caches and conflict detection. */
  version: number;
  /** Random tie-breaker regenerated on every change. */
  versionNonce: number;
  /** Seed for the deterministic hand-drawn renderer. */
  seed: number;
  isDeleted: boolean;
  /** Epoch ms of the last modification. */
  updated: number;
  flipX: boolean;
  flipY: boolean;
  link: string | null;
  customData: Record<string, unknown> | null;
}

export interface TextStyle {
  fontFamily: FontFamily;
  fontSize: number;
  fontWeight: FontWeight;
  fontStyle: FontStyle;
  textDecoration: TextDecoration;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  /** Additional spacing between characters, in world units. */
  letterSpacing: number;
}

/** Text embedded inside a shape, node or on an edge. */
export interface ShapeLabel extends TextStyle {
  text: string;
  /** Explicit label color; null inherits the element stroke color. */
  color: string | null;
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  label: ShapeLabel | null;
}
export interface EllipseElement extends BaseElement {
  type: 'ellipse';
  label: ShapeLabel | null;
}
export interface DiamondElement extends BaseElement {
  type: 'diamond';
  label: ShapeLabel | null;
}
export interface TriangleElement extends BaseElement {
  type: 'triangle';
  label: ShapeLabel | null;
}
export interface PolygonElement extends BaseElement {
  type: 'polygon';
  sides: number;
  label: ShapeLabel | null;
}
export interface StarElement extends BaseElement {
  type: 'star';
  spikes: number;
  /** Inner radius relative to outer radius (0–1). */
  innerRatio: number;
  label: ShapeLabel | null;
}

/**
 * Attachment of a linear element endpoint to another element.
 * Resolution order: `portId` (named port) → `anchor` (normalized local position) → floating
 * (outline intersection toward the opposite endpoint).
 */
export interface Binding {
  elementId: string;
  portId: string | null;
  /** Normalized [0..1, 0..1] position in the target's unrotated box. */
  anchor: [number, number] | null;
  /** Gap between the endpoint and the target outline. */
  gap: number;
}

export type ArrowPathStyle = 'sharp' | 'curved' | 'elbow';

export interface EdgeLabel extends TextStyle {
  text: string;
  /** Position along the path, 0 = start, 1 = end. */
  position: number;
  color: string | null;
}

interface LinearBase extends BaseElement {
  /** Points relative to (x, y). The first point is always [0, 0] after normalization. */
  points: LocalPoint[];
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  startBinding: Binding | null;
  endBinding: Binding | null;
  label: EdgeLabel | null;
}

export interface LineElement extends LinearBase {
  type: 'line';
  pathStyle: ArrowPathStyle;
  /** Closed lines render as polygons and can be filled. */
  closed: boolean;
}

export interface ArrowElement extends LinearBase {
  type: 'arrow';
  pathStyle: ArrowPathStyle;
}

export type ConnectorRouting = 'straight' | 'curved' | 'bezier' | 'orthogonal' | 'elbow';

/** Semantic meaning of a connector, used by UML/ER tooling. */
export type EdgeKind =
  | 'flow'
  | 'association'
  | 'dependency'
  | 'inheritance'
  | 'realization'
  | 'aggregation'
  | 'composition'
  | 'relationship'
  | 'message'
  | 'transition';

/** DiagramEdge: a semantic connection whose path is derived from its endpoints. */
export interface ConnectorElement extends LinearBase {
  type: 'connector';
  routing: ConnectorRouting;
  edgeKind: EdgeKind;
  /** Optional user-placed intermediate points (world coordinates) the route must pass through. */
  waypoints: LocalPoint[];
}

export type FreedrawBrush = 'pencil' | 'brush' | 'highlighter';

export interface FreedrawElement extends BaseElement {
  type: 'freedraw';
  points: PressurePoint[];
  brush: FreedrawBrush;
  /** True when the input device did not report pressure. */
  simulatePressure: boolean;
}

export interface TextElement extends BaseElement, TextStyle {
  type: 'text';
  text: string;
  /** Auto width grows with content; fixed width wraps text at `width`. */
  autoResize: boolean;
}

export interface ImageCrop {
  /** Crop rectangle in natural image pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  fileId: string | null;
  status: 'pending' | 'saved' | 'error';
  naturalWidth: number;
  naturalHeight: number;
  crop: ImageCrop | null;
  lockAspectRatio: boolean;
}

export interface FrameElement extends BaseElement {
  type: 'frame';
  name: string;
  /** Clip children to the frame bounds. */
  clip: boolean;
}

export type PortSide = 'top' | 'right' | 'bottom' | 'left';

export interface Port {
  id: string;
  side: PortSide;
  /** Position along the side, 0 = start (top/left), 1 = end. */
  offset: number;
}

/** DiagramNode: a semantic node rendered from the shape registry. */
export interface NodeElement extends BaseElement {
  type: 'node';
  /** Shape registry key, e.g. `database`, `server`, `cloud`, `custom`. */
  shape: string;
  label: ShapeLabel | null;
  /** Icon registry key rendered alongside the label. */
  icon: string | null;
  /** Free-form semantic metadata (e.g. technology, owner, port numbers). */
  metadata: Record<string, string>;
  /** Explicit ports; null uses the shape's default ports. */
  ports: Port[] | null;
  /** Sanitized SVG path data for `custom` shapes, in a 0–100 unit box. */
  customPath: string | null;
}

export interface TableColumn {
  id: string;
  name: string;
  dataType: string;
  primaryKey: boolean;
  foreignKey: boolean;
  nullable: boolean;
  unique: boolean;
  /** Referenced "table.column" for foreign keys (informational). */
  references: string | null;
}

/** ER diagram entity. */
export interface TableElement extends BaseElement {
  type: 'table';
  name: string;
  columns: TableColumn[];
  fontFamily: FontFamily;
  fontSize: number;
  headerColor: string;
}

export interface UmlClassElement extends BaseElement {
  type: 'uml-class';
  name: string;
  stereotype: string | null;
  attributes: string[];
  methods: string[];
  isAbstract: boolean;
  fontFamily: FontFamily;
  fontSize: number;
}

export type SequenceParticipantKind = 'participant' | 'actor' | 'database' | 'boundary' | 'control' | 'entity';
export type SequenceMessageKind = 'sync' | 'async' | 'return' | 'create' | 'destroy';

export interface SequenceParticipant {
  id: string;
  name: string;
  kind: SequenceParticipantKind;
}

export interface SequenceMessage {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: SequenceMessageKind;
}

export interface SequenceNote {
  id: string;
  /** Participant ids the note spans (1 or 2). */
  participants: string[];
  /** Message index the note is placed after (-1 = before the first message). */
  afterMessage: number;
  text: string;
}

/** Sequence diagram composite element with a semantic model. */
export interface SequenceElement extends BaseElement {
  type: 'sequence';
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
  notes: SequenceNote[];
  fontFamily: FontFamily;
  fontSize: number;
  participantSpacing: number;
  messageSpacing: number;
}

export type ShapeElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | TriangleElement
  | PolygonElement
  | StarElement;

export type LinearElement = LineElement | ArrowElement | ConnectorElement;

export type SceneElement =
  | ShapeElement
  | LinearElement
  | FreedrawElement
  | TextElement
  | ImageElement
  | FrameElement
  | NodeElement
  | TableElement
  | UmlClassElement
  | SequenceElement;

export type ElementOfType<T extends ElementType> = Extract<SceneElement, { type: T }>;

/** Partial update applicable to any element; the scene validates the merged result. */
export type ElementPatch = {
  [K in Exclude<AllKeys<SceneElement>, 'id' | 'type'>]?: ValueAt<SceneElement, K>;
};

type AllKeys<U> = U extends unknown ? keyof U : never;
type ValueAt<U, K extends PropertyKey> = U extends unknown ? (K extends keyof U ? U[K] : never) : never;

export type ElementsMap = ReadonlyMap<string, SceneElement>;

/** Metadata of binary files referenced by image elements. */
export interface FileMetadata {
  id: string;
  mimeType: string;
  /** Server-relative URL; local-only files use a data URL until uploaded. */
  url: string;
  width: number;
  height: number;
  size: number;
  created: number;
}
