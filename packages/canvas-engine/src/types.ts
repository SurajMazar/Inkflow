import type {
  Arrowhead,
  ArrowPathStyle,
  ConnectorRouting,
  FileMetadata,
  FillStyle,
  FontFamily,
  FontStyle,
  FontWeight,
  SceneElement,
  Roundness,
  StrokeStyle,
  TextAlign,
  TextDecoration,
  VerticalAlign,
} from '@inkflow/elements';
import type { Point, Rect } from '@inkflow/geometry';
import type { GridOptions, RenderTheme, ViewportState } from '@inkflow/renderer';

export type ToolType =
  | 'selection'
  | 'hand'
  | 'rectangle'
  | 'roundedRectangle'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'polygon'
  | 'star'
  | 'line'
  | 'arrow'
  | 'connector'
  | 'pencil'
  | 'brush'
  | 'highlighter'
  | 'eraser'
  | 'text'
  | 'image'
  | 'frame'
  | 'node'
  | 'comment'
  | 'laser';

/** Style applied to newly created elements and edited through the properties panel. */
export interface StyleDefaults {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  roundness: Roundness;
  fontFamily: FontFamily;
  fontSize: number;
  fontWeight: FontWeight;
  fontStyle: FontStyle;
  textDecoration: TextDecoration;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number;
  letterSpacing: number;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  arrowPathStyle: ArrowPathStyle;
  connectorRouting: ConnectorRouting;
  nodeShape: string;
  polygonSides: number;
  starSpikes: number;
}

export type TextEditKind = 'text' | 'label' | 'edge-label' | 'frame-name';

export interface TextEditState {
  elementId: string;
  kind: TextEditKind;
  /** Whether the element was created for this edit (removed if left empty). */
  isNew: boolean;
  /** Text at the start of editing, for cancel. */
  initialText: string;
}

export type InteractionKind =
  | 'idle'
  | 'panning'
  | 'pinching'
  | 'selecting'
  | 'moving'
  | 'resizing'
  | 'rotating'
  | 'creating'
  | 'drawing'
  | 'erasing'
  | 'editing-points'
  | 'cropping';

export interface ContextMenuState {
  /** Screen position relative to the canvas container. */
  x: number;
  y: number;
  world: Point;
  target: 'canvas' | 'selection' | 'locked';
  /** Element under the pointer (may be locked). */
  elementId: string | null;
}

export interface CollaboratorView {
  clientId: string;
  userId: string;
  name: string;
  color: string;
  avatarUrl: string | null;
  cursor: Point | null;
  selectedIds: string[];
  tool: string;
  active: boolean;
  editingId: string | null;
  viewport: Rect | null;
  anonymous: boolean;
}

export interface SnappingSettings {
  toGrid: boolean;
  toObjects: boolean;
  angle: boolean;
}

export interface PresentationState {
  active: boolean;
  frameIndex: number;
  frameIds: string[];
}

export interface EditorState {
  tool: ToolType;
  /** Keep the current tool after creating an element. */
  toolLocked: boolean;
  selectedIds: readonly string[];
  /** Group the user double-clicked into (selection targets its children). */
  editingGroupId: string | null;
  hoveredId: string | null;
  textEdit: TextEditState | null;
  /** Table/class/sequence element opened in the structured editor panel. */
  structuredEditId: string | null;
  /** Image being cropped. */
  cropId: string | null;
  viewport: ViewportState;
  style: StyleDefaults;
  grid: GridOptions;
  snapping: SnappingSettings;
  theme: RenderTheme;
  viewBackgroundColor: string;
  readOnly: boolean;
  zenMode: boolean;
  /** Pen mode: touch pans, only stylus draws. */
  penMode: boolean;
  /** Plain wheel zooms instead of panning. */
  zoomWithWheel: boolean;
  showFrameNames: boolean;
  interaction: InteractionKind;
  cursor: string;
  canUndo: boolean;
  canRedo: boolean;
  contextMenu: ContextMenuState | null;
  presentation: PresentationState;
  collaborators: CollaboratorView[];
  followingClientId: string | null;
  /** Incremented on every scene change (use for derived UI). */
  sceneVersion: number;
  /** Element ids highlighted by canvas search. */
  searchHighlightIds: string[];
  /** Frame ids in presentation order (persisted in the document app state). */
  frameOrder: string[];
}

export type ModifierState = {
  shift: boolean;
  alt: boolean;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
};

export interface CanvasPointerEvent extends ModifierState {
  pointerId: number;
  pointerType: 'mouse' | 'pen' | 'touch';
  button: number;
  buttons: number;
  /** Position relative to the canvas container, CSS pixels. */
  screen: Point;
  world: Point;
  pressure: number;
  /** True when the device reports real pressure values. */
  hasPressure: boolean;
  timeStamp: number;
  isPrimary: boolean;
}

/** Services provided by the embedding application. */
export interface EditorHost {
  /** Uploads an image under a client-generated UUID and returns its metadata. May resolve late (offline queue). */
  uploadImage?(file: File, fileId: string): Promise<FileMetadata>;
  /** Resolves a fileId to a loadable URL. */
  resolveFileUrl?(fileId: string): string | null;
  /** Opens a file picker for images (Image tool). */
  pickImages?(): Promise<File[]>;
  /** Requests the UI to show something (dialogs, panels). */
  onUiRequest?(request: UiRequest): void;
  /**
   * Converts external clipboard text (SVG markup, Mermaid, Excalidraw JSON…) into elements.
   * Return null to fall back to inserting plain text.
   */
  transformPastedText?(text: string): Promise<SceneElement[] | null>;
  /** Reports errors that the UI should surface. */
  onError?(error: unknown, context: string): void;
}

export type UiRequest =
  | { type: 'shortcuts' }
  | { type: 'command-palette' }
  | { type: 'find' }
  | { type: 'library' }
  | { type: 'export'; scope: 'board' | 'selection' | 'frame' | 'viewport'; frameId?: string }
  | { type: 'auto-layout' }
  | { type: 'comment'; world: Point; elementId: string | null }
  | { type: 'structured-edit'; elementId: string }
  | { type: 'present' }
  | { type: 'toggle-theme' }
  | { type: 'toast'; level: 'info' | 'error' | 'success'; message: string }
  | { type: 'link'; elementId: string };
