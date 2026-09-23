import {
  clearTextMeasureCache,
  createElement,
  getCommonBounds,
  getElementBounds,
  getShapeLabel,
  isLinearElement,
  measureTextElement,
  setTextWidthMeasurer,
  type ElementPatch,
  type ElementType,
  type FileMetadata,
  type FrameElement,
  type SceneElement,
} from '@inkflow/elements';
import { computeBoundLinearUpdates } from '@inkflow/diagram-engine';
import { boundsCenter, type Bounds, type Point } from '@inkflow/geometry';
import {
  ImageCache,
  InteractiveRenderer,
  StaticRenderer,
  type ViewportState,
} from '@inkflow/renderer';
import {
  DEFAULT_DOCUMENT_APP_STATE,
  History,
  Scene,
  Transaction,
  applyPatch,
  computeFrameMembership,
  expandSelectionToGroups,
  indicesAbove,
  orderedFrames,
  serializeDocument,
  type CommittedTransaction,
  type DocumentAppState,
  type HistoryEntry,
  type SceneDocument,
} from '@inkflow/scene';
import { generateId } from '@inkflow/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { ActionRegistry } from './actions/registry';
import { registerDefaultActions } from './actions/default-actions';
import { ClipboardManager } from './clipboard';
import { createInitialState } from './defaults';
import { Emitter } from './emitter';
import { InteractionController } from './interaction/controller';
import { buildOverlayState } from './overlay';
import { RenderLoop } from './render-loop';
import { searchScene, type SearchMatch } from './search';
import { ShortcutManager } from './shortcuts/manager';
import { computeTextEditorLayout, type TextEditorLayout } from './text-edit';
import { createTools, type Tool } from './tools';
import type {
  CollaboratorView,
  EditorHost,
  EditorState,
  StyleDefaults,
  TextEditKind,
  ToolType,
  UiRequest,
} from './types';
import {
  centerOn,
  clampZoom,
  fitBounds,
  nextZoomStep,
  screenToWorld,
  viewportCenter,
  visibleWorldBounds,
  zoomAtPoint,
} from './viewport';

export interface EditorEvents extends Record<string, unknown> {
  /** A committed local change (user action, undo/redo). Persist and broadcast it. */
  commit: CommittedTransaction;
  /** Live, uncommitted element states during a gesture (drag previews for collaborators). */
  transient: SceneElement[];
  /** Local presence changes (cursor, selection, tool, viewport, editing). */
  presence: {
    cursor?: Point | null;
    selectedIds?: string[];
    tool?: string;
    viewport?: { x: number; y: number; width: number; height: number } | null;
    editingId?: string | null;
    active?: boolean;
  };
  /** Board-level settings changed (background, grid, frame order). */
  appState: DocumentAppState;
  /** File metadata map changed (image uploaded). */
  files: Record<string, FileMetadata>;
  uiRequest: UiRequest;
  /** Document replaced (load/restore). */
  load: SceneDocument;
}

export interface EditorOptions {
  host?: EditorHost;
  initialState?: Partial<EditorState>;
  clientId?: string;
}

export interface AttachTargets {
  container: HTMLElement;
  staticCanvas: HTMLCanvasElement;
  interactiveCanvas: HTMLCanvasElement;
}

type Patches = readonly (readonly [string, ElementPatch])[];

/**
 * Framework-agnostic editor core. React (or any UI) renders chrome around it and subscribes to
 * `store`; the editor owns the scene, history, tools, interactions and rendering.
 */
export class Editor {
  readonly scene = new Scene();
  readonly history = new History(200);
  readonly store: StoreApi<EditorState>;
  readonly events = new Emitter<EditorEvents>();
  readonly actions = new ActionRegistry(this);
  readonly shortcuts: ShortcutManager;
  readonly clipboard: ClipboardManager;
  readonly clientId: string;
  host: EditorHost;
  files: Record<string, FileMetadata> = {};
  appState: DocumentAppState = { ...DEFAULT_DOCUMENT_APP_STATE };
  images: ImageCache;
  readonly tools: Record<ToolType, Tool>;

  private gesture: Transaction | null = null;
  private gestureSelectionBefore: string[] = [];
  private renderLoop: RenderLoop | null = null;
  private interaction: InteractionController | null = null;
  private detachFns: (() => void)[] = [];
  private textEditTx: Transaction | null = null;
  private destroyed = false;

  constructor(options: EditorOptions = {}) {
    this.host = options.host ?? {};
    this.clientId = options.clientId ?? generateId();
    this.store = createStore<EditorState>(() => createInitialState(options.initialState));
    this.images = new ImageCache({
      resolveUrl: (fileId) => this.host.resolveFileUrl?.(fileId) ?? this.files[fileId]?.url ?? null,
      onLoad: () => this.invalidate('static'),
      crossOrigin: 'use-credentials',
    });
    this.tools = createTools(this);
    this.shortcuts = new ShortcutManager(this);
    this.clipboard = new ClipboardManager(this);
    registerDefaultActions(this.actions);

    this.scene.subscribe((change) => {
      if (this.gesture && change.source === 'local')
        this.events.emit('transient', [...change.elements]);
      if (change.source === 'remote' || change.source === 'load') this.pruneSelection();
      this.setState({ sceneVersion: change.sceneVersion });
      this.invalidate('all');
    });
    this.history.subscribe((h) => this.setState({ canUndo: h.canUndo, canRedo: h.canRedo }));
  }

  // ───────────────────────────── state ─────────────────────────────

  get state(): EditorState {
    return this.store.getState();
  }

  setState(partial: Partial<EditorState>): void {
    const prev = this.store.getState();
    this.store.setState(partial);
    if (partial.selectedIds && partial.selectedIds !== prev.selectedIds) {
      this.events.emit('presence', { selectedIds: [...partial.selectedIds] });
    }
    if (partial.tool && partial.tool !== prev.tool)
      this.events.emit('presence', { tool: partial.tool });
    if (partial.viewport) {
      this.events.emit('presence', { viewport: this.visibleWorldRect() });
    }
    if (
      partial.viewport ||
      partial.theme ||
      partial.grid ||
      partial.viewBackgroundColor ||
      partial.showFrameNames !== undefined ||
      partial.textEdit !== undefined
    ) {
      this.invalidate('all');
    } else {
      this.invalidate('overlay');
    }
  }

  get isReadOnly(): boolean {
    return this.state.readOnly;
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  /** Binds the editor to DOM canvases; returns a detach function. */
  attach(targets: AttachTargets): () => void {
    this.installTextMeasurer();
    const staticRenderer = new StaticRenderer(targets.staticCanvas);
    const interactiveRenderer = new InteractiveRenderer(targets.interactiveCanvas);
    this.renderLoop = new RenderLoop(this, staticRenderer, interactiveRenderer);
    this.interaction = new InteractionController(
      this,
      targets.container,
      targets.interactiveCanvas,
    );
    const detachInteraction = this.interaction.attach();
    const detachKeys = this.shortcuts.attach(targets.container.ownerDocument.defaultView ?? window);
    const detachClipboard = this.clipboard.attach(targets.container.ownerDocument);

    const resize = () => {
      const rect = targets.container.getBoundingClientRect();
      const vp = this.state.viewport;
      if (rect.width !== vp.width || rect.height !== vp.height) {
        this.setState({ viewport: { ...vp, width: rect.width, height: rect.height } });
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(targets.container);
    const onFonts = () => {
      clearTextMeasureCache();
      staticRenderer.invalidate();
      this.invalidate('all');
    };
    const fonts = targets.container.ownerDocument.fonts;
    fonts?.addEventListener?.('loadingdone', onFonts);

    const detach = () => {
      observer.disconnect();
      fonts?.removeEventListener?.('loadingdone', onFonts);
      detachInteraction();
      detachKeys();
      detachClipboard();
      this.renderLoop?.dispose();
      this.renderLoop = null;
      staticRenderer.dispose();
      interactiveRenderer.dispose();
      this.interaction = null;
    };
    this.detachFns.push(detach);
    this.invalidate('all');
    return () => {
      detach();
      this.detachFns = this.detachFns.filter((d) => d !== detach);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of this.detachFns) d();
    this.detachFns = [];
    this.images.dispose();
    this.events.clear();
  }

  private installTextMeasurer() {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setTextWidthMeasurer((text, font, letterSpacing) => {
      ctx.font = font;
      return ctx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
    });
  }

  /** Schedules a redraw of the static scene, the overlay, or both. */
  invalidate(layer: 'static' | 'overlay' | 'all' = 'all'): void {
    this.renderLoop?.request(layer);
  }

  /** Keeps the overlay redrawing every frame (laser trails and other animations). */
  setOverlayAnimating(active: boolean): void {
    this.renderLoop?.setAnimating(active);
  }

  /** Interactive overlay state (exposed for tests and custom renderers). */
  buildOverlay() {
    return buildOverlayState(this);
  }

  // ───────────────────────────── document ─────────────────────────────

  loadDocument(doc: SceneDocument, options: { fit?: boolean; keepHistory?: boolean } = {}): void {
    this.cancelGesture();
    if (this.textEditTx) this.cancelTextEdit();
    this.files = { ...doc.files };
    this.appState = { ...DEFAULT_DOCUMENT_APP_STATE, ...doc.appState };
    this.scene.replaceAll(doc.elements, 'load');
    for (const el of doc.elements)
      if (el.type === 'image' && el.fileId) this.images.ensure(el.fileId);
    if (!options.keepHistory) this.history.clear();
    this.setState({
      selectedIds: [],
      editingGroupId: null,
      viewBackgroundColor: this.appState.viewBackgroundColor,
      grid: { ...this.state.grid, type: this.appState.gridType, size: this.appState.gridSize },
      frameOrder: [...this.appState.frameOrder],
    });
    if (options.fit) this.fitToContent({ animate: false });
    this.events.emit('load', doc);
  }

  getDocument(options: { includeDeleted?: boolean } = {}): SceneDocument {
    return serializeDocument(this.scene.getElementsIncludingDeleted(), this.appState, this.files, {
      includeDeleted: options.includeDeleted,
      source: 'inkflow-editor',
    });
  }

  updateAppState(partial: Partial<DocumentAppState>): void {
    if (this.isReadOnly) return;
    this.appState = { ...this.appState, ...partial };
    this.setState({
      viewBackgroundColor: this.appState.viewBackgroundColor,
      grid: { ...this.state.grid, type: this.appState.gridType, size: this.appState.gridSize },
      frameOrder: [...this.appState.frameOrder],
    });
    this.events.emit('appState', this.appState);
  }

  registerFile(meta: FileMetadata): void {
    this.files = { ...this.files, [meta.id]: meta };
    this.images.ensure(meta.id);
    this.events.emit('files', this.files);
  }

  // ───────────────────────────── queries ─────────────────────────────

  getElements(): readonly SceneElement[] {
    return this.scene.getElements();
  }

  getElement(id: string): SceneElement | undefined {
    return this.scene.getLiveElement(id);
  }

  getSelectedElements(): SceneElement[] {
    const out: SceneElement[] = [];
    for (const id of this.state.selectedIds) {
      const el = this.scene.getLiveElement(id);
      if (el) out.push(el);
    }
    return out;
  }

  getFrames(): FrameElement[] {
    return this.scene.getElements().filter((e): e is FrameElement => e.type === 'frame');
  }

  /** Frames in presentation order. */
  getOrderedFrames(): FrameElement[] {
    return orderedFrames(this.getFrames(), this.appState.frameOrder);
  }

  visibleWorldRect() {
    const b = visibleWorldBounds(this.state.viewport);
    return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
  }

  screenToWorld(p: Point): Point {
    return screenToWorld(this.state.viewport, p);
  }

  // ───────────────────────────── mutations ─────────────────────────────

  /**
   * Runs `fn` in a transaction and commits it as one history entry and one batch of operations.
   * Returns the callback result, or undefined in read-only mode.
   */
  mutate<T>(
    label: string,
    fn: (tx: Transaction) => T,
    options: { history?: boolean; merge?: boolean; selectionAfter?: string[] } = {},
  ): T | undefined {
    if (this.isReadOnly) return undefined;
    const tx = new Transaction(this.scene, label);
    const selectionBefore = [...this.state.selectedIds];
    let result: T;
    try {
      result = fn(tx);
    } catch (error) {
      tx.rollback();
      this.host.onError?.(error, label);
      throw error;
    }
    this.finishTransaction(tx, selectionBefore, options);
    return result;
  }

  private finishTransaction(
    tx: Transaction,
    selectionBefore: string[],
    options: { history?: boolean; merge?: boolean; selectionAfter?: string[] },
  ): CommittedTransaction | null {
    const committed = tx.commit();
    if (options.selectionAfter) this.setState({ selectedIds: options.selectionAfter });
    if (!committed) return null;
    if (options.history !== false) {
      const selectionAfter = [...this.state.selectedIds];
      if (!(options.merge && this.history.mergeIntoLast(committed.deltas, selectionAfter))) {
        this.history.record({
          label: committed.label,
          deltas: committed.deltas,
          selectionBefore,
          selectionAfter,
        });
      }
    }
    this.events.emit('commit', committed);
    return committed;
  }

  /** Starts a live gesture transaction (drag/resize/draw). Only one may be active. */
  beginGesture(label: string): Transaction | null {
    if (this.isReadOnly) return null;
    if (this.gesture) this.commitGesture();
    this.gesture = new Transaction(this.scene, label);
    this.gestureSelectionBefore = [...this.state.selectedIds];
    this.events.emit('presence', { active: true });
    return this.gesture;
  }

  get activeGesture(): Transaction | null {
    return this.gesture;
  }

  commitGesture(
    options: { history?: boolean; selectionAfter?: string[] } = {},
  ): CommittedTransaction | null {
    const tx = this.gesture;
    if (!tx) return null;
    this.gesture = null;
    this.events.emit('presence', { active: false });
    return this.finishTransaction(tx, this.gestureSelectionBefore, options);
  }

  cancelGesture(): void {
    const tx = this.gesture;
    if (!tx) return;
    this.gesture = null;
    tx.rollback();
    this.events.emit('presence', { active: false });
    this.setState({
      selectedIds: this.gestureSelectionBefore.filter((id) => this.scene.getLiveElement(id)),
    });
  }

  /** Adds elements on top of the scene (assigning fresh indices) and selects them. */
  addElements(
    elements: readonly SceneElement[],
    options: { select?: boolean; label?: string } = {},
  ): SceneElement[] {
    if (elements.length === 0) return [];
    const keys = indicesAbove(this.scene.getElementsIncludingDeleted(), elements.length);
    const indexed = elements.map((el, i) => ({ ...el, index: keys[i]! }));
    const frames = this.getFrames();
    const created =
      this.mutate(options.label ?? 'Add elements', (tx) => {
        const out = indexed.map((el) => tx.create(el));
        const membership = computeFrameMembership(
          out.filter((e) => !e.frameId),
          frames,
        );
        if (membership.length) tx.updateMany(membership);
        return out;
      }) ?? [];
    if (options.select !== false)
      this.setState({ selectedIds: created.map((e) => e.id), editingGroupId: null });
    return created;
  }

  /** Applies patches as one undoable change, keeping bound connectors attached. */
  updateElements(patches: Patches, label = 'Update'): void {
    if (patches.length === 0) return;
    this.mutate(label, (tx) => {
      tx.updateMany(patches);
      this.refreshBindings(
        tx,
        patches.map(([id]) => id),
      );
    });
  }

  /** Recomputes geometry of arrows/connectors bound to the given elements inside `tx`. */
  refreshBindings(tx: Transaction, changedIds: Iterable<string>): void {
    const updates = computeBoundLinearUpdates(this.scene, changedIds, {
      obstacles: (bounds: Bounds) => this.scene.queryBounds(bounds),
    });
    if (updates.length) tx.updateMany(updates);
  }

  /** Reassigns frame membership for elements (after moves/resizes). */
  refreshFrameMembership(tx: Transaction, ids: Iterable<string>): void {
    const els: SceneElement[] = [];
    for (const id of ids) {
      const el = this.scene.getLiveElement(id);
      if (el && el.type !== 'frame') els.push(el);
    }
    if (els.length === 0) return;
    const patches = computeFrameMembership(els, this.getFrames());
    if (patches.length) tx.updateMany(patches);
  }

  deleteElements(ids: readonly string[], label = 'Delete'): void {
    const targets = new Set<string>();
    for (const id of ids) {
      const el = this.scene.getLiveElement(id);
      if (!el || el.locked) continue;
      targets.add(id);
      if (el.type === 'frame')
        for (const child of this.scene.getFrameChildren(id))
          if (!child.locked) targets.add(child.id);
    }
    if (targets.size === 0) return;
    this.mutate(
      label,
      (tx) => {
        tx.delete([...targets]);
        // Bound arrows lose their binding; connectors attached to deleted nodes are removed too.
        for (const id of targets) {
          for (const linear of this.scene.getBoundLinears(id)) {
            if (targets.has(linear.id)) continue;
            if (linear.type === 'connector') {
              tx.delete([linear.id]);
            } else {
              const patch: ElementPatch = {};
              if (linear.startBinding?.elementId === id) patch.startBinding = null;
              if (linear.endBinding?.elementId === id) patch.endBinding = null;
              tx.update(linear.id, patch);
            }
          }
        }
      },
      { selectionAfter: [] },
    );
  }

  /** Applies the current style to newly created element props. */
  styleProps(type: ElementType): Partial<SceneElement> {
    const s = this.state.style;
    const base = {
      strokeColor: s.strokeColor,
      backgroundColor: s.backgroundColor,
      fillStyle: s.fillStyle,
      strokeWidth: s.strokeWidth,
      strokeStyle: s.strokeStyle,
      roughness: s.roughness,
      opacity: s.opacity,
    };
    const text = {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      fontStyle: s.fontStyle,
      textDecoration: s.textDecoration,
      textAlign: s.textAlign,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
    };
    switch (type) {
      case 'text':
        return { ...base, ...text, backgroundColor: 'transparent' } as Partial<SceneElement>;
      case 'line':
        return {
          ...base,
          backgroundColor: 'transparent',
          pathStyle: s.arrowPathStyle,
        } as Partial<SceneElement>;
      case 'arrow':
        return {
          ...base,
          backgroundColor: 'transparent',
          pathStyle: s.arrowPathStyle,
          startArrowhead: s.startArrowhead,
          endArrowhead: s.endArrowhead,
        } as Partial<SceneElement>;
      case 'connector':
        return {
          ...base,
          backgroundColor: 'transparent',
          routing: s.connectorRouting,
          startArrowhead: s.startArrowhead,
          endArrowhead:
            s.endArrowhead === 'none'
              ? 'none'
              : s.endArrowhead === 'arrow'
                ? 'triangle'
                : s.endArrowhead,
          roundness: s.roundness,
        } as Partial<SceneElement>;
      case 'frame':
        return {};
      case 'image':
        return { opacity: s.opacity };
      default:
        return { ...base, roundness: s.roundness };
    }
  }

  /** Updates the style defaults and applies the change to the current selection. */
  applyStyle(patch: Partial<StyleDefaults>, elementPatch?: ElementPatch): void {
    this.setState({ style: { ...this.state.style, ...patch } });
    const selected = this.getSelectedElements().filter((e) => !e.locked);
    elementPatch ??= patch as ElementPatch;
    if (selected.length === 0) return;
    const patches: (readonly [string, ElementPatch])[] = [];
    for (const el of selected) {
      const p = adaptPatchToElement(el, elementPatch);
      if (Object.keys(p).length) patches.push([el.id, p]);
    }
    if (patches.length === 0) return;
    // Continuous edits (dragging a color or slider) collapse into one undo step.
    const last = this.history.peekUndo();
    const selectionKey = selected.map((e) => e.id).join(',');
    const merge =
      !!last &&
      last.label === 'Change style' &&
      Date.now() - this.lastStyleChange.time < 1000 &&
      this.lastStyleChange.selection === selectionKey;
    this.lastStyleChange = { time: Date.now(), selection: selectionKey };
    this.mutate(
      'Change style',
      (tx) => {
        tx.updateMany(patches);
        this.refreshBindings(
          tx,
          patches.map(([id]) => id),
        );
      },
      { merge },
    );
  }

  private lastStyleChange = { time: 0, selection: '' };

  // ───────────────────────────── history ─────────────────────────────

  undo(): void {
    if (this.isReadOnly) return;
    this.commitTextEditIfAny();
    this.cancelGesture();
    const entry = this.history.undo();
    if (entry) this.applyHistoryEntry(entry, 'before');
  }

  redo(): void {
    if (this.isReadOnly) return;
    this.commitTextEditIfAny();
    this.cancelGesture();
    const entry = this.history.redo();
    if (entry) this.applyHistoryEntry(entry, 'after');
  }

  private applyHistoryEntry(entry: HistoryEntry, direction: 'before' | 'after') {
    const tx = new Transaction(
      this.scene,
      direction === 'before' ? `Undo ${entry.label}` : `Redo ${entry.label}`,
      'history',
    );
    for (const d of entry.deltas) {
      const patch = direction === 'before' ? d.before : d.after;
      const existing = this.scene.getElement(d.id);
      if (existing) tx.update(d.id, patch);
      else if (direction === 'after' || !patch.isDeleted) tx.create(applyPatch(d.snapshot, patch));
    }
    const committed = tx.commit();
    const selection = direction === 'before' ? entry.selectionBefore : entry.selectionAfter;
    this.setState({ selectedIds: selection.filter((id) => this.scene.getLiveElement(id)) });
    if (committed) this.events.emit('commit', committed);
  }

  // ───────────────────────────── selection ─────────────────────────────

  select(
    ids: readonly string[],
    options: { additive?: boolean; expandGroups?: boolean } = {},
  ): void {
    const base = options.additive ? new Set(this.state.selectedIds) : new Set<string>();
    const expanded =
      options.expandGroups === false
        ? new Set(ids)
        : expandSelectionToGroups(ids, this.scene.getElements(), this.state.editingGroupId);
    for (const id of expanded) {
      const el = this.scene.getLiveElement(id);
      if (el && !el.hidden) base.add(id);
    }
    this.setState({ selectedIds: [...base] });
  }

  clearSelection(): void {
    if (this.state.selectedIds.length || this.state.editingGroupId || this.state.cropId) {
      this.setState({ selectedIds: [], editingGroupId: null, cropId: null });
    }
  }

  selectAll(): void {
    const ids = this.scene
      .getElements()
      .filter(
        (e) =>
          !e.locked &&
          !e.hidden &&
          (!this.state.editingGroupId || e.groupIds.includes(this.state.editingGroupId)),
      )
      .map((e) => e.id);
    this.setState({ selectedIds: ids });
  }

  private pruneSelection() {
    const { selectedIds, textEdit } = this.state;
    const live = selectedIds.filter((id) => this.scene.getLiveElement(id));
    if (live.length !== selectedIds.length) this.store.setState({ selectedIds: live });
    if (textEdit && !this.scene.getLiveElement(textEdit.elementId)) this.cancelTextEdit();
  }

  // ───────────────────────────── tools ─────────────────────────────

  get activeTool(): Tool {
    return this.tools[this.state.tool];
  }

  setTool(tool: ToolType, options: { lock?: boolean } = {}): void {
    if (this.isReadOnly && !['selection', 'hand', 'laser', 'comment'].includes(tool)) return;
    const prev = this.state.tool;
    if (prev !== tool) {
      this.tools[prev].deactivate();
      this.commitTextEditIfAny();
    }
    this.setState({
      tool,
      toolLocked: options.lock ?? this.state.toolLocked,
      cursor: this.tools[tool].cursor(),
      contextMenu: null,
      ...(tool !== 'selection' ? { hoveredId: null } : {}),
    });
    if (prev !== tool) this.tools[tool].activate();
  }

  /** Called by creation tools when finished: returns to selection unless the tool is locked. */
  finishToolUse(): void {
    if (!this.state.toolLocked) this.setTool('selection');
  }

  // ───────────────────────────── viewport ─────────────────────────────

  setViewport(next: ViewportState): void {
    this.setState({ viewport: { ...next, zoom: clampZoom(next.zoom) } });
  }

  zoomAt(zoom: number, screenPoint?: Point): void {
    const vp = this.state.viewport;
    this.setViewport(zoomAtPoint(vp, zoom, screenPoint ?? viewportCenter(vp)));
  }

  zoomIn(): void {
    this.zoomAt(nextZoomStep(this.state.viewport.zoom, 1));
  }

  zoomOut(): void {
    this.zoomAt(nextZoomStep(this.state.viewport.zoom, -1));
  }

  resetZoom(): void {
    this.zoomAt(1);
  }

  fitToBounds(
    bounds: Bounds | null,
    options: { maxZoom?: number; padding?: number; animate?: boolean } = {},
  ): void {
    if (!bounds) return;
    const target = fitBounds(this.state.viewport, bounds, {
      padding: options.padding ?? 64,
      maxZoom: options.maxZoom ?? 1,
    });
    this.setViewport(target);
  }

  fitToContent(options: { animate?: boolean } = {}): void {
    const elements = this.scene.getElements().filter((e) => !e.hidden);
    if (elements.length === 0) {
      this.setViewport({
        ...this.state.viewport,
        x: -this.state.viewport.width / 2,
        y: -this.state.viewport.height / 2,
        zoom: 1,
      });
      return;
    }
    this.fitToBounds(getCommonBounds(elements), { animate: options.animate });
  }

  fitToSelection(): void {
    const selected = this.getSelectedElements();
    if (selected.length === 0) return this.fitToContent();
    this.fitToBounds(getCommonBounds(selected), { maxZoom: 2 });
  }

  fitToElements(ids: readonly string[], maxZoom = 2): void {
    const els = ids
      .map((id) => this.scene.getLiveElement(id))
      .filter((e): e is SceneElement => !!e);
    if (els.length) this.fitToBounds(getCommonBounds(els), { maxZoom });
  }

  scrollToPoint(world: Point): void {
    this.setViewport(centerOn(this.state.viewport, world));
  }

  // ───────────────────────────── collaboration ─────────────────────────────

  /** Applies authoritative element states from collaborators/server (no history, no ops). */
  applyRemoteElements(elements: readonly SceneElement[]): void {
    if (elements.length === 0) return;
    const editing = this.state.textEdit?.elementId;
    const filtered = editing ? elements.filter((e) => e.id !== editing || e.isDeleted) : elements;
    this.scene.upsert(filtered, 'remote');
    for (const el of filtered) if (el.type === 'image' && el.fileId) this.images.ensure(el.fileId);
  }

  setCollaborators(collaborators: CollaboratorView[]): void {
    this.setState({ collaborators });
    const following = this.state.followingClientId;
    if (following) {
      const peer = collaborators.find((c) => c.clientId === following);
      if (!peer) this.setState({ followingClientId: null });
      else if (peer.viewport) {
        const v = peer.viewport;
        this.fitToBounds(
          { minX: v.x, minY: v.y, maxX: v.x + v.width, maxY: v.y + v.height },
          { padding: 0, maxZoom: 30 },
        );
      }
    }
  }

  followCollaborator(clientId: string | null): void {
    this.setState({ followingClientId: clientId });
    if (clientId) this.setCollaborators(this.state.collaborators);
  }

  /** Last known pointer position in world coordinates (paste target). */
  lastPointerWorld: Point | null = null;

  /** Reports the local cursor for presence. */
  reportCursor(world: Point | null): void {
    if (world) this.lastPointerWorld = world;
    this.events.emit('presence', { cursor: world });
  }

  requestUi(request: UiRequest): void {
    this.events.emit('uiRequest', request);
    this.host.onUiRequest?.(request);
  }

  // ───────────────────────────── text editing ─────────────────────────────

  /** Opens the inline text editor for a text element, shape label, edge label or frame name. */
  startTextEdit(elementId: string, kind: TextEditKind, options: { isNew?: boolean } = {}): void {
    if (this.isReadOnly) return;
    const el = this.scene.getLiveElement(elementId);
    if (!el || el.locked) return;
    this.commitTextEditIfAny();
    const initialText =
      kind === 'text' && el.type === 'text'
        ? el.text
        : kind === 'frame-name' && el.type === 'frame'
          ? el.name
          : kind === 'label'
            ? (getShapeLabel(el)?.text ?? '')
            : isLinearElement(el)
              ? (el.label?.text ?? '')
              : '';
    this.textEditTx = new Transaction(this.scene, kind === 'text' ? 'Edit text' : 'Edit label');
    this.setState({
      textEdit: { elementId, kind, isNew: options.isNew ?? false, initialText },
      selectedIds: [elementId],
      interaction: 'idle',
    });
    this.events.emit('presence', { editingId: elementId });
  }

  /** Live update from the text editor overlay. */
  updateTextEdit(text: string): void {
    const edit = this.state.textEdit;
    const tx = this.textEditTx;
    if (!edit || !tx) return;
    const el = this.scene.getLiveElement(edit.elementId);
    if (!el) return;
    const patch = textPatch(el, edit.kind, text, this.state.style);
    if (patch) {
      tx.update(el.id, patch);
      if (edit.kind === 'text' || edit.kind === 'label') this.refreshBindings(tx, [el.id]);
      this.events.emit('transient', [this.scene.getElement(el.id)!]);
    }
  }

  commitTextEdit(): void {
    const edit = this.state.textEdit;
    const tx = this.textEditTx;
    if (!edit || !tx) return;
    this.textEditTx = null;
    const el = this.scene.getLiveElement(edit.elementId);
    const empty = el?.type === 'text' && el.text.trim() === '';
    this.setState({ textEdit: null });
    this.events.emit('presence', { editingId: null });
    if (empty) {
      if (edit.isNew) {
        tx.rollback();
        this.setState({ selectedIds: [] });
        return;
      }
      tx.delete([edit.elementId]);
    }
    const selectionBefore = edit.isNew ? [] : [edit.elementId];
    this.finishTransaction(tx, selectionBefore, {
      merge: false,
      selectionAfter: empty ? [] : [edit.elementId],
    });
  }

  cancelTextEdit(): void {
    const edit = this.state.textEdit;
    const tx = this.textEditTx;
    this.textEditTx = null;
    this.setState({ textEdit: null });
    this.events.emit('presence', { editingId: null });
    if (!edit || !tx) return;
    if (edit.isNew) {
      tx.rollback();
      this.setState({ selectedIds: [] });
    } else {
      tx.rollback();
    }
  }

  commitTextEditIfAny(): void {
    if (this.state.textEdit) this.commitTextEdit();
  }

  getTextEditorLayout(): TextEditorLayout | null {
    const edit = this.state.textEdit;
    if (!edit) return null;
    const el = this.scene.getLiveElement(edit.elementId);
    if (!el) return null;
    return computeTextEditorLayout(el, edit.kind, this.state.viewport);
  }

  /** Creates a text element at a world point and opens the editor. */
  createTextAt(world: Point): void {
    const s = this.state.style;
    const el = createElement('text', {
      ...(this.styleProps('text') as object),
      x: world.x,
      y: world.y - (s.fontSize * s.lineHeight) / 2,
      text: '',
      autoResize: true,
    });
    if (this.isReadOnly) return;
    this.commitTextEditIfAny();
    const size = measureTextElement({ ...el, text: 'W' });
    const [index] = indicesAbove(this.scene.getElementsIncludingDeleted(), 1);
    // Creation and the first edit form one transaction: an abandoned empty text leaves no trace.
    const tx = new Transaction(this.scene, 'Add text');
    const created = tx.create({ ...el, width: size.width, height: size.height, index: index! });
    this.refreshFrameMembership(tx, [created.id]);
    this.textEditTx = tx;
    this.setState({
      textEdit: { elementId: created.id, kind: 'text', isNew: true, initialText: '' },
      selectedIds: [created.id],
      interaction: 'idle',
    });
    this.events.emit('presence', { editingId: created.id });
  }

  // ───────────────────────────── images ─────────────────────────────

  /** Inserts image files centered at `at` (world) or the viewport center; uploads them via the host. */
  async insertImageFiles(files: readonly File[], at?: Point): Promise<void> {
    const { insertImages } = await import('./images');
    await insertImages(this, files, at ?? this.screenToWorld(viewportCenter(this.state.viewport)));
  }

  // ───────────────────────────── search ─────────────────────────────

  search(query: string): SearchMatch[] {
    return searchScene(this.scene.getElements(), query);
  }

  focusElement(id: string): void {
    const el = this.scene.getLiveElement(id);
    if (!el) return;
    this.setState({ selectedIds: [id], searchHighlightIds: [id] });
    const b = getElementBounds(el);
    const vp = this.state.viewport;
    const visible = visibleWorldBounds(vp);
    const fits =
      b.maxX - b.minX < visible.maxX - visible.minX &&
      b.maxY - b.minY < visible.maxY - visible.minY;
    if (fits) this.scrollToPoint(boundsCenter(b));
    else this.fitToBounds(b, { maxZoom: vp.zoom });
  }

  // ───────────────────────────── presentation ─────────────────────────────

  startPresentation(startFrameId?: string): boolean {
    const frames = this.getOrderedFrames();
    if (frames.length === 0) {
      this.requestUi({
        type: 'toast',
        level: 'info',
        message: 'Add frames to present them as slides.',
      });
      return false;
    }
    this.commitTextEditIfAny();
    const index = Math.max(0, startFrameId ? frames.findIndex((f) => f.id === startFrameId) : 0);
    this.setState({
      presentation: { active: true, frameIndex: index, frameIds: frames.map((f) => f.id) },
      selectedIds: [],
      tool: 'selection',
    });
    this.goToFrame(index);
    return true;
  }

  stopPresentation(): void {
    this.setState({ presentation: { ...this.state.presentation, active: false } });
  }

  goToFrame(index: number): void {
    const { frameIds } = this.state.presentation;
    if (frameIds.length === 0) return;
    const i = Math.max(0, Math.min(frameIds.length - 1, index));
    const frame = this.scene.getLiveElement(frameIds[i]!);
    this.setState({ presentation: { ...this.state.presentation, frameIndex: i } });
    if (frame) this.fitToBounds(getElementBounds(frame), { padding: 24, maxZoom: 30 });
  }

  nextFrame(): void {
    this.goToFrame(this.state.presentation.frameIndex + 1);
  }

  previousFrame(): void {
    this.goToFrame(this.state.presentation.frameIndex - 1);
  }

  /** Moves a frame within the presentation order. */
  reorderFrame(frameId: string, toIndex: number): void {
    const order = this.getOrderedFrames()
      .map((f) => f.id)
      .filter((id) => id !== frameId);
    order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, frameId);
    this.updateAppState({ frameOrder: order });
  }

  // ───────────────────────────── context menu ─────────────────────────────

  openContextMenu(screen: Point, world: Point, elementId: string | null, locked: boolean): void {
    const selected = new Set(this.state.selectedIds);
    let target: 'canvas' | 'selection' | 'locked' = 'canvas';
    if (elementId && locked) target = 'locked';
    else if (elementId) {
      if (!selected.has(elementId)) this.select([elementId]);
      target = 'selection';
    } else if (selected.size) {
      target = 'canvas';
    }
    this.setState({ contextMenu: { x: screen.x, y: screen.y, world, target, elementId } });
  }

  closeContextMenu(): void {
    if (this.state.contextMenu) this.setState({ contextMenu: null });
  }
}

/** Translates a style patch to what makes sense for a given element type. */
function adaptPatchToElement(el: SceneElement, patch: ElementPatch): ElementPatch {
  const out: Record<string, unknown> = {};
  const textKeys = [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'textDecoration',
    'textAlign',
    'verticalAlign',
    'lineHeight',
    'letterSpacing',
  ];
  for (const [key, value] of Object.entries(patch)) {
    if (textKeys.includes(key)) {
      if (el.type === 'text') out[key] = value;
      else if (
        (el.type === 'table' || el.type === 'uml-class' || el.type === 'sequence') &&
        (key === 'fontFamily' || key === 'fontSize')
      )
        out[key] = value;
      else if ('label' in el && el.label)
        out.label = { ...el.label, ...((out.label as object) ?? {}), [key]: value };
      continue;
    }
    if (key in el) out[key] = value;
  }
  if (
    el.type === 'text' &&
    ('fontSize' in out ||
      'fontFamily' in out ||
      'letterSpacing' in out ||
      'lineHeight' in out ||
      'fontWeight' in out)
  ) {
    const size = measureTextElement({ ...el, ...(out as Partial<typeof el>) });
    out.width = el.autoResize ? size.width : el.width;
    out.height = size.height;
  }
  return out as ElementPatch;
}

function textPatch(
  el: SceneElement,
  kind: TextEditKind,
  text: string,
  style: StyleDefaults,
): ElementPatch | null {
  if (kind === 'text' && el.type === 'text') {
    const size = measureTextElement({ ...el, text });
    return { text, width: el.autoResize ? size.width : el.width, height: size.height };
  }
  if (kind === 'frame-name' && el.type === 'frame') return { name: text };
  if (kind === 'label' && 'label' in el && !isLinearElement(el)) {
    const base = el.label ?? createLabelDefaults(style);
    return { label: { ...base, text } } as ElementPatch;
  }
  if (kind === 'edge-label' && isLinearElement(el)) {
    const base = el.label ?? createEdgeLabelDefaults(style);
    return { label: { ...base, text } } as ElementPatch;
  }
  return null;
}

function createLabelDefaults(style: StyleDefaults) {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textDecoration: style.textDecoration,
    textAlign: 'center' as const,
    verticalAlign: 'middle' as const,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    color: null,
    text: '',
  };
}

function createEdgeLabelDefaults(style: StyleDefaults) {
  return {
    ...createLabelDefaults(style),
    fontSize: Math.max(12, style.fontSize - 4),
    position: 0.5,
  };
}
