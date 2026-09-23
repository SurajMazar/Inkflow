import {
  computeConnectorRoute,
  findBindingCandidate,
  getElementPorts,
  getOutlinePolygon,
  type BindingCandidate,
} from '@inkflow/diagram-engine';
import {
  createBinding,
  createElement,
  normalizeLinearPoints,
  type ConnectorElement,
  type ElementPatch,
  type LinearElement,
  type LocalPoint,
} from '@inkflow/elements';
import { expandBounds, type Point } from '@inkflow/geometry';
import type { InteractiveRenderState } from '@inkflow/renderer';
import { indicesAbove } from '@inkflow/scene';
import { EMPTY_GUIDES, snapVectorAngle, type SnapGuides } from '../snapping';
import type { CanvasPointerEvent } from '../types';
import { BaseTool, DRAG_THRESHOLD_PX, snapDrawingPoint } from './base';

type LinearToolType = 'line' | 'arrow' | 'connector';

interface DrawingState {
  id: string;
  /** Committed world points (the last one follows the pointer). */
  points: Point[];
  down: CanvasPointerEvent;
  dragged: boolean;
  /** Click-to-add-points mode (after a click without drag). */
  multiPoint: boolean;
  startCandidate: BindingCandidate | null;
  endCandidate: BindingCandidate | null;
  guides: SnapGuides;
}

/** Draws lines, arrows and semantic connectors, binding arrow/connector endpoints to shapes. */
export class LinearTool extends BaseTool {
  private drawing: DrawingState | null = null;
  private hoverCandidate: BindingCandidate | null = null;

  constructor(
    editor: ConstructorParameters<typeof BaseTool>[0],
    readonly id: LinearToolType,
  ) {
    super(editor);
  }

  override isBusy(): boolean {
    return this.drawing !== null;
  }

  private get binds(): boolean {
    return this.id !== 'line';
  }

  private findCandidate(world: Point, excludeId: string | null, e: CanvasPointerEvent): BindingCandidate | null {
    if (!this.binds || e.mod) return null;
    const candidates = this.editor.scene.queryPoint(world.x, world.y, this.px(24));
    return findBindingCandidate(candidates, world, this.px(12), {
      excludeIds: excludeId ? new Set([excludeId]) : undefined,
      portSnapDistance: this.px(18),
    });
  }

  override onPointerDown(e: CanvasPointerEvent): void {
    const editor = this.editor;
    const d = this.drawing;
    if (d && d.multiPoint) {
      // Clicking near the previous point (or the start) finishes the path.
      const prev = d.points[d.points.length - 2];
      const nearPrev = prev && Math.hypot(e.world.x - prev.x, e.world.y - prev.y) < this.px(10);
      if (nearPrev || d.endCandidate) {
        if (nearPrev) d.points.pop();
        this.finish();
        return;
      }
      d.points.push({ ...d.points[d.points.length - 1]! });
      this.sync();
      return;
    }
    const tx = editor.beginGesture(`Create ${this.id}`);
    if (!tx) return;
    const startCandidate = this.findCandidate(e.world, null, e);
    const start = startCandidate?.point ?? snapDrawingPoint(editor, e.world, new Set(), e.mod).point;
    const el = createElement(this.id, {
      ...(editor.styleProps(this.id) as object),
      x: start.x,
      y: start.y,
      points: [
        [0, 0],
        [0, 0],
      ],
      startBinding: startCandidate
        ? createBinding(startCandidate.element.id, { portId: startCandidate.portId, anchor: startCandidate.anchor })
        : null,
    } as never);
    const [index] = indicesAbove(editor.scene.getElementsIncludingDeleted(), 1);
    tx.create({ ...el, index: index! });
    editor.setState({ selectedIds: [], interaction: 'creating' });
    this.drawing = {
      id: el.id,
      points: [start, { ...start }],
      down: e,
      dragged: false,
      multiPoint: false,
      startCandidate,
      endCandidate: null,
      guides: EMPTY_GUIDES,
    };
  }

  override onPointerMove(e: CanvasPointerEvent): void {
    const d = this.drawing;
    if (!d) {
      this.hoverCandidate = this.findCandidate(e.world, null, e);
      this.editor.invalidate('overlay');
      return;
    }
    if (!d.multiPoint && e.buttons === 0) return;
    if (!d.dragged && !d.multiPoint) {
      if (Math.hypot(e.screen.x - d.down.screen.x, e.screen.y - d.down.screen.y) < DRAG_THRESHOLD_PX[e.pointerType]) return;
      d.dragged = true;
    }
    this.updateEnd(e);
  }

  private updateEnd(e: CanvasPointerEvent) {
    const d = this.drawing;
    if (!d) return;
    d.endCandidate = this.findCandidate(e.world, d.id, e);
    const prev = d.points[d.points.length - 2]!;
    let end = e.world;
    d.guides = EMPTY_GUIDES;
    if (d.endCandidate) {
      end = d.endCandidate.point;
    } else if (e.shift || (this.editor.state.snapping.angle && this.id !== 'connector' && e.alt)) {
      end = snapVectorAngle(prev, end);
    } else {
      const snap = snapDrawingPoint(this.editor, end, new Set([d.id]), e.mod);
      end = snap.point;
      d.guides = snap;
    }
    d.points[d.points.length - 1] = end;
    this.sync();
  }

  /** Writes the in-progress geometry into the scene. */
  private sync() {
    const d = this.drawing;
    const tx = this.editor.activeGesture;
    if (!d || !tx) return;
    const norm = normalizeLinearPoints(0, 0, d.points.map((p) => [p.x, p.y] as LocalPoint));
    const patch: ElementPatch = { x: norm.x, y: norm.y, width: norm.width, height: norm.height, points: norm.points };
    if (this.binds) {
      patch.endBinding = d.endCandidate
        ? createBinding(d.endCandidate.element.id, { portId: d.endCandidate.portId, anchor: d.endCandidate.anchor })
        : null;
    }
    const updated = tx.update(d.id, patch);
    if (updated && updated.type === 'connector') {
      const route = computeConnectorRoute(updated as ConnectorElement, (id) => this.editor.scene.getLiveElement(id), this.obstaclesFor(updated));
      tx.update(d.id, route);
    }
  }

  private obstaclesFor(el: LinearElement) {
    const pad = 200;
    return this.editor.scene
      .queryBounds(expandBounds({ minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height }, pad))
      .filter((o) => o.id !== el.id && o.type !== 'arrow' && o.type !== 'line' && o.type !== 'connector' && o.type !== 'freedraw' && o.type !== 'frame');
  }

  override onPointerUp(e: CanvasPointerEvent): void {
    const d = this.drawing;
    if (!d) return;
    if (d.multiPoint) return;
    if (!d.dragged) {
      if (this.id === 'connector') {
        // A click without drag creates nothing for connectors; they are always dragged.
        this.onCancel();
        return;
      }
      d.multiPoint = true;
      this.updateEnd(e);
      return;
    }
    this.finish();
  }

  override onDoubleClick(): void {
    const d = this.drawing;
    if (d?.multiPoint) {
      // The double click added a duplicate point; drop it.
      if (d.points.length > 2) d.points.pop();
      this.finish();
    }
  }

  private finish() {
    const d = this.drawing;
    const editor = this.editor;
    this.drawing = null;
    if (!d) return;
    const first = d.points[0]!;
    const last = d.points[d.points.length - 1]!;
    const length = d.points.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - d.points[i - 1]!.x, p.y - d.points[i - 1]!.y)), 0);
    if (length < this.px(4) && Math.hypot(last.x - first.x, last.y - first.y) < this.px(4)) {
      editor.cancelGesture();
      editor.setState({ interaction: 'idle' });
      return;
    }
    this.sync();
    const tx = editor.activeGesture;
    if (tx) editor.refreshFrameMembership(tx, [d.id]);
    editor.commitGesture({ selectionAfter: [d.id] });
    editor.setState({ interaction: 'idle' });
    editor.finishToolUse();
  }

  override onKeyDown(e: KeyboardEvent): boolean {
    if (!this.drawing) return false;
    if (e.key === 'Escape' || e.key === 'Enter') {
      if (this.drawing.multiPoint && this.drawing.points.length > 2) this.drawing.points.pop();
      this.finish();
      return true;
    }
    return false;
  }

  override onCancel(): void {
    if (this.drawing) this.editor.cancelGesture();
    this.drawing = null;
    this.editor.setState({ interaction: 'idle' });
  }

  override deactivate(): void {
    if (this.drawing?.multiPoint) this.finish();
    else this.onCancel();
    this.hoverCandidate = null;
  }

  override overlay(): Partial<InteractiveRenderState> {
    const candidate = this.drawing ? (this.drawing.endCandidate ?? (this.drawing.dragged ? null : this.drawing.startCandidate)) : this.hoverCandidate;
    const out: Partial<InteractiveRenderState> = {};
    if (candidate) {
      out.bindingHighlight = getOutlinePolygon(candidate.element);
      out.ports = getElementPorts(candidate.element).map((p) => ({ point: p.point, active: p.id === candidate.portId }));
    }
    if (this.drawing) {
      out.snapLines = this.drawing.guides.lines;
      out.snapPoints = this.drawing.guides.points;
    }
    return out;
  }
}
