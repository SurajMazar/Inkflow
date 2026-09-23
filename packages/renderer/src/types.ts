/**
 * Public contracts of the rendering engine. The canvas engine produces these draw descriptions;
 * the renderer only draws them. Keep this file free of implementation.
 */
import type { SceneElement, FileMetadata } from '@inkflow/elements';
import type { Point, Rect } from '@inkflow/geometry';

/**
 * Viewport convention used everywhere:
 *   screenX = (worldX - x) * zoom,  screenY = (worldY - y) * zoom
 * `x, y` = world coordinate shown at the top-left of the canvas; width/height in CSS pixels.
 */
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

export type RenderTheme = 'light' | 'dark';
export type GridType = 'dot' | 'square' | 'isometric';

export interface GridOptions {
  visible: boolean;
  type: GridType;
  /** Grid spacing in world units. */
  size: number;
}

/** Source of decoded images for image elements, keyed by fileId. */
export interface ImageSource {
  /** Returns a drawable image when loaded, otherwise null (the renderer draws a placeholder). */
  get(fileId: string): CanvasImageSource | null;
  /** Status for placeholders. */
  status(fileId: string): 'loading' | 'loaded' | 'error' | 'missing';
}

export interface StaticRenderOptions {
  viewport: ViewportState;
  pixelRatio: number;
  /** Canvas background color, or null for transparent. */
  background: string | null;
  grid: GridOptions;
  theme: RenderTheme;
  images: ImageSource;
  /** Elements to skip entirely (e.g. text currently edited in the DOM overlay). */
  skipIds?: ReadonlySet<string>;
  /** Element whose embedded label is being edited (label not drawn). */
  editingLabelId?: string | null;
  showFrameNames: boolean;
  /** Cheaper rendering while panning/zooming large scenes. */
  lowFidelity?: boolean;
  /** Element lookup (frames for clipping, binding targets). */
  getElement: (id: string) => SceneElement | undefined;
}

export interface RenderStats {
  /** Elements actually drawn after culling. */
  drawn: number;
  culled: number;
  durationMs: number;
}

export type HandleKind = 'resize' | 'rotate' | 'point' | 'midpoint' | 'crop';

export interface OverlayHandle {
  id: string;
  kind: HandleKind;
  /** Center in world coordinates. */
  x: number;
  y: number;
  /** Rotation of square handles (radians). */
  angle: number;
  active?: boolean;
}

export interface RemoteCursor {
  clientId: string;
  name: string;
  color: string;
  /** World coordinates. */
  x: number;
  y: number;
  active: boolean;
  tool: string;
}

export interface RemoteSelection {
  clientId: string;
  name: string;
  color: string;
  /** World-space closed polygons (one per selected element). */
  outlines: Point[][];
}

/**
 * Everything drawn on the interactive (overlay) canvas. Geometry is in world coordinates; sizes of
 * handles, strokes and labels are constant in screen pixels.
 */
export interface InteractiveRenderState {
  viewport: ViewportState;
  pixelRatio: number;
  theme: RenderTheme;
  /** Accent color for selection chrome. */
  accentColor: string;
  /** Outline polygon per selected element (thin lines). */
  selectionOutlines: Point[][];
  /** Oriented selection box (4 corners, clockwise from top-left) when transform handles show. */
  selectionBox: Point[] | null;
  /** Dashed group outlines (groups in the selection). */
  groupOutlines: Point[][];
  handles: OverlayHandle[];
  /** Drag-selection rectangle. */
  marquee: Rect | null;
  lasso: Point[] | null;
  hoverOutline: Point[] | null;
  /** Alignment guide segments. */
  snapLines: { from: Point; to: Point }[];
  /** Small crosses at snapped points. */
  snapPoints: Point[];
  /** Highlight around a connection target while dragging an arrow endpoint. */
  bindingHighlight: Point[] | null;
  /** Connection ports shown on hover/drag; `active` = the port currently snapped to. */
  ports: { point: Point; active: boolean }[];
  remoteCursors: RemoteCursor[];
  remoteSelections: RemoteSelection[];
  /** Trail of the eraser pointer. */
  eraserTrail: Point[];
  /** Outlines of elements that will be erased. */
  eraserTargets: Point[][];
  /** Frame currently receiving dropped elements. */
  frameHighlight: Point[] | null;
  /** Point-editing mode for lines/arrows. */
  linearEditor: {
    points: Point[];
    selectedIndices: number[];
    midpoints: Point[];
  } | null;
  /** Image crop editor: full image rect and the crop rect (world, unrotated) plus element angle. */
  cropEditor: { imageRect: Rect; cropRect: Rect; angle: number; center: Point } | null;
  /** Pending comment pins, drawn as markers (world). */
  commentPins: {
    id: string;
    x: number;
    y: number;
    resolved: boolean;
    active: boolean;
    count: number;
  }[];
  /** Search result highlights. */
  searchHighlights: Point[][];
  /** Laser-pointer trail for presentations. */
  laserTrail: Point[];
}

/** Options for rendering elements outside of the live editor (exports, thumbnails). */
export interface SceneRenderOptions {
  /** World-space rectangle to render. */
  bounds: Rect;
  /** Output pixels per world unit. */
  scale: number;
  background: string | null;
  theme: RenderTheme;
  images: ImageSource;
  showFrameNames: boolean;
  getElement: (id: string) => SceneElement | undefined;
}

export interface SvgRenderOptions {
  bounds: Rect;
  scale: number;
  background: string | null;
  theme: RenderTheme;
  /** Data URLs (or absolute URLs) of image files keyed by fileId. */
  imageData: Record<string, string>;
  files: Record<string, FileMetadata>;
  /** Embed @font-face rules (with the provided font data URLs) for self-contained SVGs. */
  fontFaces?: { family: string; dataUrl: string; weight?: string; style?: string }[];
  showFrameNames: boolean;
  getElement: (id: string) => SceneElement | undefined;
  /** Text embedded (XML-escaped) in a `<metadata>` element, e.g. the serialized scene. */
  metadata?: string;
  /** Prefix for generated ids (clip paths, filters) so several SVGs can be inlined in one page. */
  idPrefix?: string;
}

export type { SceneElement };
