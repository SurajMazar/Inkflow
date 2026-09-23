import {
  findBindingCandidate,
  getElementPorts,
  getOutlinePolygon,
  measureSequence,
  measureTable,
  measureUmlClass,
  type BindingCandidate,
} from '@inkflow/diagram-engine';
import {
  createBinding,
  getElementBounds,
  getLinearWorldPoints,
  hasShapeLabel,
  isBindingElement,
  isElementInsideBounds,
  isLinearElement,
  normalizeLinearPoints,
  prefersAspectRatio,
  type ElementPatch,
  type ImageElement,
  type LinearElement,
  type LocalPoint,
  type SceneElement,
} from '@inkflow/elements';
import { rotatePoint, type Bounds, type Point } from '@inkflow/geometry';
import type { InteractiveRenderState, OverlayHandle } from '@inkflow/renderer';
import { duplicateElements, indicesAbove, selectionGroupFor } from '@inkflow/scene';
import { hitTestAll, hitTestTop, hitTolerancePx, pointInSelectionFrame } from '../hit-test';
import {
  EMPTY_GUIDES,
  SNAP_THRESHOLD_PX,
  snapBoundsToGrid,
  snapBoundsToObjects,
  snapVectorAngle,
  type SnapGuides,
} from '../snapping';
import {
  computeLinearHandles,
  computeTransformHandles,
  cursorForHandle,
  frameCorners,
  getSelectionFrame,
  handlePoint,
  hitTestHandles,
  type ResizeHandle,
  type SelectionFrame,
} from '../transform/handles';
import { applyBoxToElement, resizeBox, resizeMultiple } from '../transform/resize';
import { rotateElements, rotationDelta } from '../transform/rotate';
import type { CanvasPointerEvent } from '../types';
import { BaseTool, DRAG_THRESHOLD_PX, snapCandidates, snapDrawingPoint } from './base';

type Mode =
  | { kind: 'idle' }
  | {
      kind: 'pending';
      down: CanvasPointerEvent;
      hitId: string | null;
      wasSelected: boolean;
      insideSelection: boolean;
    }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean; base: string[] }
  | {
      kind: 'moving';
      start: Point;
      originals: Map<string, SceneElement>;
      bounds: Bounds;
      guides: SnapGuides;
      frameTarget: string | null;
    }
  | {
      kind: 'resizing';
      handle: ResizeHandle;
      frame: SelectionFrame;
      originals: SceneElement[];
      guides: SnapGuides;
      /** Offset between the pointer and the box edge at the start of the drag. */
      grab: Point;
    }
  | { kind: 'rotating'; center: Point; start: Point; originals: SceneElement[]; baseAngle: number }
  | {
      kind: 'point';
      elementId: string;
      index: number;
      original: LinearElement;
      candidate: BindingCandidate | null;
      moved: boolean;
      guides: SnapGuides;
    }
  | { kind: 'crop'; handle: ResizeHandle; original: ImageElement };

const CROP_PREFIX = 'crop:';

export class SelectionTool extends BaseTool {
  readonly id = 'selection' as const;
  private mode: Mode = { kind: 'idle' };
  private selectedPoint: { elementId: string; index: number } | null = null;

  override cursor(): string {
    return 'default';
  }

  override isBusy(): boolean {
    return this.mode.kind !== 'idle' && this.mode.kind !== 'pending';
  }

  // ───────────── handles ─────────────

  private currentHandles(): OverlayHandle[] {
    const s = this.editor.state;
    if (s.readOnly) return [];
    if (s.cropId) return this.cropHandles();
    const selected = this.editor.getSelectedElements();
    if (selected.length === 0 || selected.every((e) => e.locked)) return [];
    if (selected.length === 1 && isLinearElement(selected[0]!)) {
      const el = selected[0]!;
      const pointHandles = computeLinearHandles(el, { endpointsOnly: el.type === 'connector' });
      if (el.points.length > 2 && el.type !== 'connector') {
        const frame = getSelectionFrame(selected);
        if (frame) {
          const box = computeTransformHandles(frame, {
            zoom: this.zoom,
            rotatable: true,
            resizable: true,
          });
          return [...pointHandles, ...box];
        }
      }
      return pointHandles;
    }
    const frame = getSelectionFrame(selected);
    if (!frame) return [];
    return computeTransformHandles(frame, {
      zoom: this.zoom,
      rotatable: !selected.some((e) => e.type === 'frame'),
      resizable: true,
    });
  }

  private cropHandles(): OverlayHandle[] {
    const el = this.editor.state.cropId
      ? this.editor.getElement(this.editor.state.cropId)
      : undefined;
    if (!el || el.type !== 'image') return [];
    const frame: SelectionFrame = {
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      angle: el.angle,
    };
    return computeTransformHandles(frame, {
      zoom: this.zoom,
      rotatable: false,
      resizable: true,
    }).map((h) => ({
      ...h,
      id: CROP_PREFIX + h.id,
      kind: 'crop' as const,
    }));
  }

  // ───────────── pointer down ─────────────

  override onPointerDown(e: CanvasPointerEvent): void {
    const editor = this.editor;
    const s = editor.state;
    editor.commitTextEditIfAny();
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    // Handles first.
    const handle = hitTestHandles(this.currentHandles(), e.world, this.zoom, e.pointerType);
    if (handle) {
      this.startHandleDrag(handle, e);
      return;
    }

    if (s.cropId) {
      const cropEl = editor.getElement(s.cropId);
      if (!cropEl || !pointInSelectionFrame(getSelectionFrame([cropEl]), e.world, 0)) {
        editor.setState({ cropId: null });
      } else {
        return;
      }
    }

    const tolerance = hitTolerancePx(e.pointerType) / this.zoom;
    const selectedFrame = getSelectionFrame(editor.getSelectedElements());
    const hit = hitTestTop(editor.scene, e.world, { tolerance });
    const selectedIds = new Set(s.selectedIds);
    const hitSelected = hit ? selectedIds.has(hit.id) : false;
    // Dragging anywhere inside the selection box moves the selection (unless another element is hit).
    const insideSelection =
      selectedIds.size > 0 &&
      pointInSelectionFrame(selectedFrame, e.world, this.px(4)) &&
      (!hit || hitSelected);

    if (hit && !hitSelected) {
      if (e.mod) {
        editor.select([hit.id], { additive: e.shift, expandGroups: false });
      } else if (e.shift) {
        editor.select([hit.id], { additive: true });
      } else {
        if (s.editingGroupId && !hit.groupIds.includes(s.editingGroupId))
          editor.setState({ editingGroupId: null });
        editor.select([hit.id]);
      }
    }
    this.selectedPoint = null;
    this.mode = {
      kind: 'pending',
      down: e,
      hitId: hit?.id ?? null,
      wasSelected: hitSelected,
      insideSelection,
    };
  }

  private startHandleDrag(handle: OverlayHandle, e: CanvasPointerEvent) {
    const editor = this.editor;
    const selected = editor.getSelectedElements().filter((el) => !el.locked);
    if (handle.id.startsWith(CROP_PREFIX)) {
      const el = editor.state.cropId ? editor.getElement(editor.state.cropId) : undefined;
      if (!el || el.type !== 'image') return;
      if (!editor.beginGesture('Crop image')) return;
      this.mode = {
        kind: 'crop',
        handle: handle.id.slice(CROP_PREFIX.length) as ResizeHandle,
        original: el,
      };
      editor.setState({ interaction: 'cropping' });
      return;
    }
    if (handle.id === 'rotation') {
      const frame = getSelectionFrame(selected);
      if (!frame || !editor.beginGesture('Rotate')) return;
      const originals = this.withFrameChildren(selected);
      this.mode = {
        kind: 'rotating',
        center: { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
        start: e.world,
        originals,
        baseAngle: selected.length === 1 ? selected[0]!.angle : 0,
      };
      editor.setState({ interaction: 'rotating', cursor: 'grabbing' });
      return;
    }
    if (handle.kind === 'point' || handle.kind === 'midpoint') {
      const el = selected[0];
      if (!el || !isLinearElement(el)) return;
      const tx = editor.beginGesture('Edit points');
      if (!tx) return;
      const baked = this.bakeRotation(el);
      const index = Number(handle.id.split(':')[1]);
      let targetIndex = index;
      let original = baked;
      if (handle.kind === 'midpoint') {
        const pts = [...baked.points];
        const a = pts[index]!;
        const b = pts[index + 1]!;
        pts.splice(index + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        const updated = tx.update(el.id, { points: pts }) as LinearElement;
        original = updated;
        targetIndex = index + 1;
      } else if (baked !== el) {
        tx.update(el.id, {
          x: baked.x,
          y: baked.y,
          width: baked.width,
          height: baked.height,
          points: baked.points,
          angle: 0,
        });
      }
      this.selectedPoint = { elementId: el.id, index: targetIndex };
      this.mode = {
        kind: 'point',
        elementId: el.id,
        index: targetIndex,
        original,
        candidate: null,
        moved: false,
        guides: EMPTY_GUIDES,
      };
      editor.setState({ interaction: 'editing-points' });
      return;
    }
    const frame = getSelectionFrame(selected);
    if (!frame || !editor.beginGesture('Resize')) return;
    const onBox = handlePoint(frame, handle.id as ResizeHandle);
    const grab = { x: e.world.x - onBox.x, y: e.world.y - onBox.y };
    this.mode = {
      kind: 'resizing',
      handle: handle.id as ResizeHandle,
      frame,
      originals: selected,
      guides: EMPTY_GUIDES,
      grab,
    };
    editor.setState({
      interaction: 'resizing',
      cursor: cursorForHandle(handle.id as ResizeHandle, frame.angle),
    });
  }

  /** Converts a rotated linear element into an equivalent unrotated one (for point editing). */
  private bakeRotation(el: LinearElement): LinearElement {
    if (el.angle === 0) return el;
    const world = getLinearWorldPoints(el);
    const norm = normalizeLinearPoints(
      0,
      0,
      world.map((p) => [p.x, p.y] as LocalPoint),
    );
    return { ...el, ...norm, angle: 0 };
  }

  private withFrameChildren(elements: readonly SceneElement[]): SceneElement[] {
    const out = new Map(elements.map((e) => [e.id, e]));
    for (const el of elements) {
      if (el.type !== 'frame') continue;
      for (const child of this.editor.scene.getFrameChildren(el.id))
        if (!child.locked) out.set(child.id, child);
    }
    return [...out.values()];
  }

  // ───────────── pointer move ─────────────

  override onPointerMove(e: CanvasPointerEvent): void {
    const mode = this.mode;
    switch (mode.kind) {
      case 'idle':
        this.updateHover(e);
        return;
      case 'pending': {
        const d = Math.hypot(e.screen.x - mode.down.screen.x, e.screen.y - mode.down.screen.y);
        if (d < DRAG_THRESHOLD_PX[e.pointerType]) return;
        if ((mode.hitId || mode.insideSelection) && !this.editor.isReadOnly)
          this.startMove(mode.down, e);
        else this.startMarquee(mode.down, e);
        return;
      }
      case 'marquee':
        this.updateMarquee(e);
        return;
      case 'moving':
        this.updateMove(e);
        return;
      case 'resizing':
        this.updateResize(e);
        return;
      case 'rotating':
        this.updateRotate(e);
        return;
      case 'point':
        this.updatePoint(e);
        return;
      case 'crop':
        this.updateCrop(e);
        return;
    }
  }

  private updateHover(e: CanvasPointerEvent) {
    const editor = this.editor;
    if (e.pointerType === 'touch') return;
    const handle = hitTestHandles(this.currentHandles(), e.world, this.zoom, e.pointerType);
    if (handle) {
      const frame = getSelectionFrame(editor.getSelectedElements());
      const cursor =
        handle.kind === 'resize' || handle.kind === 'crop'
          ? cursorForHandle(handle.id.replace(CROP_PREFIX, '') as ResizeHandle, frame?.angle ?? 0)
          : handle.kind === 'rotate'
            ? 'grab'
            : 'pointer';
      if (editor.state.cursor !== cursor || editor.state.hoveredId)
        editor.setState({ cursor, hoveredId: null });
      return;
    }
    const hit = hitTestTop(editor.scene, e.world, {
      tolerance: hitTolerancePx(e.pointerType) / this.zoom,
    });
    const inside = pointInSelectionFrame(
      getSelectionFrame(editor.getSelectedElements()),
      e.world,
      this.px(4),
    );
    const cursor = hit || inside ? (editor.isReadOnly ? 'default' : 'move') : 'default';
    const hoveredId = hit?.id ?? null;
    if (editor.state.cursor !== cursor || editor.state.hoveredId !== hoveredId)
      editor.setState({ cursor, hoveredId });
  }

  private startMarquee(down: CanvasPointerEvent, e: CanvasPointerEvent) {
    const additive = down.shift;
    if (!additive) this.editor.clearSelection();
    this.mode = {
      kind: 'marquee',
      start: down.world,
      current: e.world,
      additive,
      base: [...this.editor.state.selectedIds],
    };
    this.editor.setState({ interaction: 'selecting' });
    this.updateMarquee(e);
  }

  private updateMarquee(e: CanvasPointerEvent) {
    if (this.mode.kind !== 'marquee') return;
    this.mode.current = e.world;
    const b = this.marqueeBounds();
    const inside = this.editor.scene
      .queryBounds(b)
      .filter((el) => !el.locked && !el.hidden && isElementInsideBounds(el, b))
      .filter((el) => !el.frameId || !this.isInsideSelectedFrame(el, b))
      .map((el) => el.id);
    const ids = this.mode.additive ? [...new Set([...this.mode.base, ...inside])] : inside;
    // Expand groups only when the whole group is inside the marquee.
    const scene = this.editor.scene;
    const expanded = ids.filter((id) => {
      const el = scene.getLiveElement(id)!;
      const g = selectionGroupFor(el, this.editor.state.editingGroupId);
      if (!g) return true;
      return scene.getGroupElements(g).every((m) => ids.includes(m.id) || m.locked);
    });
    const prev = this.editor.state.selectedIds;
    if (expanded.length !== prev.length || expanded.some((id, i) => prev[i] !== id)) {
      this.editor.setState({ selectedIds: expanded });
    } else {
      this.editor.invalidate('overlay');
    }
  }

  private isInsideSelectedFrame(el: SceneElement, b: Bounds): boolean {
    // Children of a frame that is itself entirely inside the marquee are selected via the frame.
    const frame = el.frameId ? this.editor.getElement(el.frameId) : undefined;
    return !!frame && isElementInsideBounds(frame, b);
  }

  private marqueeBounds(): Bounds {
    if (this.mode.kind !== 'marquee') return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const { start, current } = this.mode;
    return {
      minX: Math.min(start.x, current.x),
      minY: Math.min(start.y, current.y),
      maxX: Math.max(start.x, current.x),
      maxY: Math.max(start.y, current.y),
    };
  }

  private startMove(down: CanvasPointerEvent, e: CanvasPointerEvent) {
    const editor = this.editor;
    let selected = editor.getSelectedElements().filter((el) => !el.locked);
    if (selected.length === 0) return;
    const tx = editor.beginGesture(down.alt ? 'Duplicate' : 'Move');
    if (!tx) return;
    if (down.alt) {
      const frameIds = new Set(editor.getFrames().map((f) => f.id));
      const sources = this.withFrameChildren(selected);
      const { elements: copies, idMap } = duplicateElements(sources, {
        existingFrameIds: frameIds,
      });
      const keys = indicesAbove(editor.scene.getElementsIncludingDeleted(), copies.length);
      const created = copies.map((c, i) => tx.create({ ...c, index: keys[i]! }));
      const selection = selected.map((el) => idMap.get(el.id)).filter((id): id is string => !!id);
      editor.setState({ selectedIds: selection });
      selected = created;
    }
    const moving = down.alt ? selected : this.withFrameChildren(selected);
    const movingIds = new Set(moving.map((m) => m.id));
    // Linear elements dragged away from their (non-moving) targets lose those bindings.
    for (const el of moving) {
      if (!isLinearElement(el)) continue;
      const patch: ElementPatch = {};
      if (el.startBinding && !movingIds.has(el.startBinding.elementId)) patch.startBinding = null;
      if (el.endBinding && !movingIds.has(el.endBinding.elementId)) patch.endBinding = null;
      if (Object.keys(patch).length) tx.update(el.id, patch);
    }
    const originals = new Map(moving.map((m) => [m.id, editor.scene.getElement(m.id)!]));
    const bounds = boundsOf([...originals.values()]);
    this.mode = {
      kind: 'moving',
      start: down.world,
      originals,
      bounds,
      guides: EMPTY_GUIDES,
      frameTarget: null,
    };
    editor.setState({ interaction: 'moving', cursor: 'move', hoveredId: null });
    this.updateMove(e);
  }

  private updateMove(e: CanvasPointerEvent) {
    const mode = this.mode;
    const tx = this.editor.activeGesture;
    if (mode.kind !== 'moving' || !tx) return;
    let dx = e.world.x - mode.start.x;
    let dy = e.world.y - mode.start.y;
    if (e.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const moved: Bounds = {
      minX: mode.bounds.minX + dx,
      minY: mode.bounds.minY + dy,
      maxX: mode.bounds.maxX + dx,
      maxY: mode.bounds.maxY + dy,
    };
    const { snapping, grid } = this.editor.state;
    let guides: SnapGuides = EMPTY_GUIDES;
    if (snapping.toGrid) {
      const g = snapBoundsToGrid(moved, grid.size);
      dx += g.dx;
      dy += g.dy;
    } else if (snapping.toObjects !== e.mod) {
      const snap = snapBoundsToObjects(
        moved,
        snapCandidates(this.editor, new Set(mode.originals.keys())),
        SNAP_THRESHOLD_PX / this.zoom,
      );
      dx += snap.dx;
      dy += snap.dy;
      guides = snap;
    }
    mode.guides = guides;
    const patches: (readonly [string, ElementPatch])[] = [];
    for (const [id, el] of mode.originals) {
      const patch: ElementPatch = { x: el.x + dx, y: el.y + dy };
      if (el.type === 'connector' && el.waypoints.length)
        patch.waypoints = el.waypoints.map(([x, y]) => [x + dx, y + dy]);
      patches.push([id, patch]);
    }
    tx.updateMany(patches);
    this.editor.refreshBindings(tx, mode.originals.keys());
    // Frame drop target highlight.
    const center = {
      x: (mode.bounds.minX + mode.bounds.maxX) / 2 + dx,
      y: (mode.bounds.minY + mode.bounds.maxY) / 2 + dy,
    };
    const frames = this.editor.getFrames().filter((f) => !mode.originals.has(f.id));
    let target: string | null = null;
    for (let i = frames.length - 1; i >= 0; i--) {
      const fb = getElementBounds(frames[i]!);
      if (
        center.x >= fb.minX &&
        center.x <= fb.maxX &&
        center.y >= fb.minY &&
        center.y <= fb.maxY
      ) {
        target = frames[i]!.id;
        break;
      }
    }
    mode.frameTarget = [...mode.originals.values()].some((o) => o.type !== 'frame') ? target : null;
  }

  private updateResize(e: CanvasPointerEvent) {
    const mode = this.mode;
    const tx = this.editor.activeGesture;
    if (mode.kind !== 'resizing' || !tx) return;
    // Keep the grab offset (handles sit slightly outside the box) so the edge doesn't jump.
    let pointer = { x: e.world.x - mode.grab.x, y: e.world.y - mode.grab.y };
    mode.guides = EMPTY_GUIDES;
    if (mode.frame.angle === 0) {
      const snap = snapDrawingPoint(
        this.editor,
        pointer,
        new Set(mode.originals.map((o) => o.id)),
        e.mod,
      );
      pointer = snap.point;
      mode.guides = snap;
    }
    const single = mode.originals.length === 1 ? mode.originals[0]! : null;
    const keepAspect = single ? e.shift !== prefersAspectRatio(single) : e.shift;
    const box = resizeBox(mode.frame, mode.handle, pointer, { keepAspect, fromCenter: e.alt });
    let patches: Map<string, ElementPatch>;
    if (single) {
      const patch = applyBoxToElement(single, box, mode.handle);
      enforceMinSize(single, patch);
      patches = new Map([[single.id, patch]]);
    } else {
      patches = resizeMultiple(
        mode.originals,
        mode.frame,
        box,
        e.shift || mode.originals.some((o) => o.angle !== 0),
      );
    }
    tx.updateMany([...patches.entries()]);
    this.editor.refreshBindings(tx, patches.keys());
  }

  private updateRotate(e: CanvasPointerEvent) {
    const mode = this.mode;
    const tx = this.editor.activeGesture;
    if (mode.kind !== 'rotating' || !tx) return;
    const delta = rotationDelta(mode.center, mode.start, e.world, mode.baseAngle, e.shift);
    const patches = rotateElements(mode.originals, mode.center, delta);
    tx.updateMany([...patches.entries()]);
    this.editor.refreshBindings(tx, patches.keys());
  }

  private updatePoint(e: CanvasPointerEvent) {
    const mode = this.mode;
    const editor = this.editor;
    const tx = editor.activeGesture;
    if (mode.kind !== 'point' || !tx) return;
    mode.moved = true;
    const el = mode.original;
    const worldPts = el.points.map(([x, y]) => ({ x: el.x + x, y: el.y + y }));
    const isEndpoint = mode.index === 0 || mode.index === worldPts.length - 1;
    let target = e.world;
    mode.candidate = null;
    mode.guides = EMPTY_GUIDES;
    if (isEndpoint && isBindingElement(el) && !e.mod) {
      const candidates = editor.scene.queryPoint(e.world.x, e.world.y, this.px(24));
      mode.candidate = findBindingCandidate(candidates, e.world, this.px(12), {
        excludeIds: new Set([el.id]),
        portSnapDistance: this.px(16),
      });
      if (mode.candidate) target = mode.candidate.point;
    }
    if (!mode.candidate) {
      const neighbor = worldPts[mode.index === 0 ? 1 : mode.index - 1];
      if (e.shift && neighbor) target = snapVectorAngle(neighbor, target);
      else {
        const snap = snapDrawingPoint(editor, target, new Set([el.id]), e.mod);
        target = snap.point;
        mode.guides = snap;
      }
    }
    worldPts[mode.index] = target;
    const norm = normalizeLinearPoints(
      0,
      0,
      worldPts.map((p) => [p.x, p.y] as LocalPoint),
    );
    const patch: ElementPatch = {
      x: norm.x,
      y: norm.y,
      width: norm.width,
      height: norm.height,
      points: norm.points,
    };
    if (isEndpoint && isBindingElement(el)) {
      const binding = mode.candidate
        ? createBinding(mode.candidate.element.id, {
            portId: mode.candidate.portId,
            anchor: mode.candidate.anchor,
          })
        : null;
      if (mode.index === 0) patch.startBinding = binding;
      else patch.endBinding = binding;
    }
    tx.update(el.id, patch);
    editor.refreshBindings(tx, [el.id]);
  }

  private updateCrop(e: CanvasPointerEvent) {
    const mode = this.mode;
    const tx = this.editor.activeGesture;
    if (mode.kind !== 'crop' || !tx) return;
    const el = mode.original;
    const crop = el.crop ?? { x: 0, y: 0, width: el.naturalWidth, height: el.naturalHeight };
    const scale = el.width / Math.max(1, crop.width);
    const frame: SelectionFrame = {
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      angle: el.angle,
    };
    const box = resizeBox(frame, mode.handle, e.world, { keepAspect: e.shift, fromCenter: false });
    const origCenter = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    const newCenter = rotatePoint(
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      origCenter,
      -el.angle,
    );
    let localX = newCenter.x - box.width / 2;
    let localY = newCenter.y - box.height / 2;
    // Clamp the crop rectangle to the image.
    const imgX = el.x - crop.x * scale;
    const imgY = el.y - crop.y * scale;
    const imgW = el.naturalWidth * scale;
    const imgH = el.naturalHeight * scale;
    let w = box.width;
    let h = box.height;
    const minSize = this.px(12);
    if (localX < imgX) {
      w -= imgX - localX;
      localX = imgX;
    }
    if (localY < imgY) {
      h -= imgY - localY;
      localY = imgY;
    }
    w = Math.max(minSize, Math.min(w, imgX + imgW - localX));
    h = Math.max(minSize, Math.min(h, imgY + imgH - localY));
    const worldCenter = rotatePoint({ x: localX + w / 2, y: localY + h / 2 }, origCenter, el.angle);
    tx.update(el.id, {
      x: worldCenter.x - w / 2,
      y: worldCenter.y - h / 2,
      width: w,
      height: h,
      crop: {
        x: (localX - imgX) / scale,
        y: (localY - imgY) / scale,
        width: w / scale,
        height: h / scale,
      },
    });
  }

  // ───────────── pointer up ─────────────

  override onPointerUp(e: CanvasPointerEvent): void {
    const mode = this.mode;
    const editor = this.editor;
    this.mode = { kind: 'idle' };
    switch (mode.kind) {
      case 'pending':
        this.handleClick(mode, e);
        break;
      case 'moving': {
        const tx = editor.activeGesture;
        if (tx) editor.refreshFrameMembership(tx, mode.originals.keys());
        editor.commitGesture();
        break;
      }
      case 'point':
        if (!mode.moved) {
          editor.cancelGesture();
          editor.setState({ selectedIds: [mode.elementId] });
        } else {
          editor.commitGesture();
        }
        break;
      case 'resizing':
      case 'rotating': {
        const tx = editor.activeGesture;
        if (tx)
          editor.refreshFrameMembership(
            tx,
            mode.originals.map((o) => o.id),
          );
        editor.commitGesture();
        break;
      }
      case 'crop':
        editor.commitGesture();
        break;
      default:
        break;
    }
    editor.setState({ interaction: 'idle', cursor: 'default' });
    editor.invalidate('overlay');
  }

  private handleClick(mode: Extract<Mode, { kind: 'pending' }>, e: CanvasPointerEvent) {
    const editor = this.editor;
    const hitId = mode.hitId;
    if (!hitId) {
      // Clicking empty space inside a selection box keeps the selection.
      if (!mode.insideSelection && !e.shift) editor.clearSelection();
      return;
    }
    if (e.alt) {
      // Click-through: cycle to the next element under the pointer.
      const stack = hitTestAll(editor.scene, e.world, {
        tolerance: hitTolerancePx(e.pointerType) / this.zoom,
      });
      if (stack.length > 1) {
        const current = stack.findIndex((el) => editor.state.selectedIds.includes(el.id));
        const next = stack[(current + 1) % stack.length]!;
        editor.select([next.id], { expandGroups: !e.mod });
      }
      return;
    }
    if (e.shift && mode.wasSelected) {
      const el = editor.getElement(hitId);
      const unit = el ? selectionGroupFor(el, editor.state.editingGroupId) : null;
      const remove = new Set(unit ? editor.scene.getGroupElements(unit).map((m) => m.id) : [hitId]);
      editor.setState({ selectedIds: editor.state.selectedIds.filter((id) => !remove.has(id)) });
      return;
    }
    if (!e.shift && (mode.wasSelected || mode.insideSelection)) {
      editor.select([hitId], { expandGroups: !e.mod });
    }
  }

  // ───────────── double click ─────────────

  override onDoubleClick(e: CanvasPointerEvent): void {
    const editor = this.editor;
    if (editor.state.presentation.active) return;
    if (editor.state.cropId) {
      editor.setState({ cropId: null });
      return;
    }
    const tolerance = hitTolerancePx(e.pointerType) / this.zoom;
    const hit = hitTestTop(editor.scene, e.world, { tolerance });
    if (!hit) {
      if (!editor.isReadOnly) editor.createTextAt(e.world);
      return;
    }
    // Enter groups first.
    const group = selectionGroupFor(hit, editor.state.editingGroupId);
    if (group && editor.state.editingGroupId !== group) {
      editor.setState({ editingGroupId: group });
      editor.select([hit.id]);
      return;
    }
    if (editor.isReadOnly) return;
    if (hit.type === 'text') return editor.startTextEdit(hit.id, 'text');
    if (hit.type === 'frame') return editor.startTextEdit(hit.id, 'frame-name');
    if (hit.type === 'image') {
      editor.setState({ cropId: hit.id, selectedIds: [hit.id] });
      return;
    }
    if (hit.type === 'table' || hit.type === 'uml-class' || hit.type === 'sequence') {
      editor.setState({ structuredEditId: hit.id, selectedIds: [hit.id] });
      editor.requestUi({ type: 'structured-edit', elementId: hit.id });
      return;
    }
    if (isLinearElement(hit)) {
      if (hit.type === 'line' && !hit.label) {
        // Double-click a plain line to insert a point at the cursor.
        this.insertPointAt(hit, e.world);
        return;
      }
      return editor.startTextEdit(hit.id, 'edge-label');
    }
    if (hasShapeLabel(hit)) return editor.startTextEdit(hit.id, 'label');
  }

  private insertPointAt(el: LinearElement, world: Point) {
    const baked = this.bakeRotation(el);
    const pts = baked.points.map(([x, y]) => ({ x: baked.x + x, y: baked.y + y }));
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = Math.hypot(mid.x - world.x, mid.y - world.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    pts.splice(best + 1, 0, world);
    const norm = normalizeLinearPoints(
      0,
      0,
      pts.map((p) => [p.x, p.y] as LocalPoint),
    );
    this.editor.updateElements([[el.id, { ...norm, angle: 0 }]], 'Add point');
  }

  // ───────────── keyboard & cancel ─────────────

  override onKeyDown(e: KeyboardEvent): boolean {
    const editor = this.editor;
    if (e.key === 'Escape') {
      if (this.mode.kind !== 'idle' && this.mode.kind !== 'pending') {
        this.onCancel();
        return true;
      }
      if (editor.state.cropId) {
        editor.setState({ cropId: null });
        return true;
      }
      if (editor.state.editingGroupId) {
        const members = editor.scene.getGroupElements(editor.state.editingGroupId).map((m) => m.id);
        editor.setState({ editingGroupId: null, selectedIds: members });
        return true;
      }
      return false;
    }
    if (e.key === 'Enter' && editor.state.cropId) {
      editor.setState({ cropId: null });
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedPoint) {
      const el = editor.getElement(this.selectedPoint.elementId);
      if (
        el &&
        isLinearElement(el) &&
        el.type !== 'connector' &&
        el.points.length > 2 &&
        editor.state.selectedIds.length === 1
      ) {
        const baked = this.bakeRotation(el);
        const pts = baked.points.map(([x, y]) => [baked.x + x, baked.y + y] as LocalPoint);
        pts.splice(this.selectedPoint.index, 1);
        const norm = normalizeLinearPoints(0, 0, pts);
        editor.updateElements([[el.id, { ...norm, angle: 0 }]], 'Delete point');
        this.selectedPoint = null;
        return true;
      }
    }
    return false;
  }

  override onCancel(): void {
    if (this.mode.kind !== 'idle' && this.mode.kind !== 'pending' && this.mode.kind !== 'marquee')
      this.editor.cancelGesture();
    this.mode = { kind: 'idle' };
    this.editor.setState({ interaction: 'idle' });
  }

  override deactivate(): void {
    this.onCancel();
    this.editor.setState({ hoveredId: null });
  }

  // ───────────── overlay ─────────────

  override overlay(): Partial<InteractiveRenderState> {
    const mode = this.mode;
    const out: Partial<InteractiveRenderState> = {};
    if (mode.kind === 'marquee') {
      const b = this.marqueeBounds();
      out.marquee = { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
    }
    if (mode.kind === 'moving' || mode.kind === 'resizing' || mode.kind === 'point') {
      out.snapLines = mode.guides.lines;
      out.snapPoints = mode.guides.points;
    }
    if (mode.kind === 'moving' && mode.frameTarget) {
      const f = this.editor.getElement(mode.frameTarget);
      if (f) out.frameHighlight = frameCorners(getSelectionFrame([f])!);
    }
    if (mode.kind === 'point' && mode.candidate) {
      out.bindingHighlight = getOutlinePolygon(mode.candidate.element);
      out.ports = getElementPorts(mode.candidate.element).map((p) => ({
        point: p.point,
        active: p.id === mode.candidate?.portId,
      }));
    }
    if (this.selectedPoint && out.handles === undefined) {
      const el = this.editor.getElement(this.selectedPoint.elementId);
      if (el && isLinearElement(el) && this.editor.state.selectedIds.length === 1) {
        out.handles = computeLinearHandles(el, { endpointsOnly: el.type === 'connector' }).map(
          (h) => (h.id === `point:${this.selectedPoint!.index}` ? { ...h, active: true } : h),
        );
      }
    }
    return out;
  }
}

function boundsOf(elements: readonly SceneElement[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    const b = getElementBounds(el);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
}

/** Structured elements can't shrink below their content. */
function enforceMinSize(el: SceneElement, patch: ElementPatch) {
  const width = patch.width ?? el.width;
  if (el.type === 'table') {
    const min = measureTable({ ...el, width });
    patch.width = Math.max(width, min.width);
    patch.height = Math.max(patch.height ?? el.height, min.height);
  } else if (el.type === 'uml-class') {
    const min = measureUmlClass({ ...el, width });
    patch.width = Math.max(width, min.width);
    patch.height = Math.max(patch.height ?? el.height, min.height);
  } else if (el.type === 'sequence') {
    const min = measureSequence({ ...el, width });
    patch.width = Math.max(width, min.width);
    patch.height = Math.max(patch.height ?? el.height, min.height);
  }
}
