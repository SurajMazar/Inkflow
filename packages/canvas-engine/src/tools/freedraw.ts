import {
  createElement,
  normalizeLinearPoints,
  type FreedrawBrush,
  type PressurePoint,
} from '@inkflow/elements';
import { simplifyRDP } from '@inkflow/geometry';
import { indicesAbove } from '@inkflow/scene';
import type { CanvasPointerEvent } from '../types';
import { BaseTool } from './base';

type FreedrawToolType = 'pencil' | 'brush' | 'highlighter';

const BRUSH: Record<FreedrawToolType, FreedrawBrush> = {
  pencil: 'pencil',
  brush: 'brush',
  highlighter: 'highlighter',
};
const HIGHLIGHTER_DEFAULT = '#fab005';

/** Vector freehand drawing with pressure (or simulated pressure), smoothing and simplification. */
export class FreedrawTool extends BaseTool {
  private drawing: {
    id: string;
    origin: { x: number; y: number };
    points: PressurePoint[];
    hasPressure: boolean;
  } | null = null;

  constructor(
    editor: ConstructorParameters<typeof BaseTool>[0],
    readonly id: FreedrawToolType,
  ) {
    super(editor);
  }

  override cursor(): string {
    return 'crosshair';
  }

  override isBusy(): boolean {
    return this.drawing !== null;
  }

  override onPointerDown(e: CanvasPointerEvent): void {
    const editor = this.editor;
    if (editor.state.penMode && e.pointerType === 'touch') return;
    const tx = editor.beginGesture(`Draw (${this.id})`);
    if (!tx) return;
    const style = editor.state.style;
    const highlighter = this.id === 'highlighter';
    const el = createElement('freedraw', {
      strokeColor:
        highlighter && style.strokeColor === '#1e1e1e' ? HIGHLIGHTER_DEFAULT : style.strokeColor,
      backgroundColor: 'transparent',
      strokeWidth:
        this.id === 'brush'
          ? style.strokeWidth * 2
          : highlighter
            ? Math.max(4, style.strokeWidth * 3)
            : style.strokeWidth,
      opacity: highlighter ? Math.min(style.opacity, 45) : style.opacity,
      roughness: 0,
      x: e.world.x,
      y: e.world.y,
      points: [[0, 0, e.pressure]],
      brush: BRUSH[this.id],
      simulatePressure: !e.hasPressure,
    });
    const [index] = indicesAbove(editor.scene.getElementsIncludingDeleted(), 1);
    tx.create({ ...el, index: index! });
    editor.setState({ selectedIds: [], interaction: 'drawing' });
    this.drawing = {
      id: el.id,
      origin: e.world,
      points: [[0, 0, e.pressure]],
      hasPressure: e.hasPressure,
    };
  }

  override onPointerMove(e: CanvasPointerEvent): void {
    const d = this.drawing;
    const tx = this.editor.activeGesture;
    if (!d || !tx) return;
    const last = d.points[d.points.length - 1]!;
    const x = e.world.x - d.origin.x;
    const y = e.world.y - d.origin.y;
    // Skip samples closer than half a screen pixel.
    if (Math.hypot(x - last[0], y - last[1]) < this.px(0.5)) return;
    d.points.push([x, y, e.hasPressure ? e.pressure : 0.5]);
    tx.update(d.id, { points: d.points.slice() });
  }

  override onPointerUp(): void {
    const d = this.drawing;
    const editor = this.editor;
    this.drawing = null;
    const tx = editor.activeGesture;
    if (!d || !tx) return;
    let pts = d.points;
    if (pts.length === 1) pts = [pts[0]!, [pts[0]![0] + 0.5, pts[0]![1] + 0.5, pts[0]![2]]];
    // Simplify in world space while keeping pressure; tolerance tied to zoom so detail matches what was drawn.
    const tolerance = this.px(0.35);
    const simplified = simplifyRDP(
      pts.map((p) => ({ x: p[0], y: p[1], pressure: p[2] })),
      tolerance,
    ).map((p) => [p.x, p.y, p.pressure] as PressurePoint);
    const norm = normalizeLinearPoints(d.origin.x, d.origin.y, simplified);
    tx.update(d.id, {
      x: norm.x,
      y: norm.y,
      width: norm.width,
      height: norm.height,
      points: norm.points,
    });
    editor.refreshFrameMembership(tx, [d.id]);
    editor.commitGesture();
    editor.setState({ interaction: 'idle' });
  }

  override onDoubleClick(e: CanvasPointerEvent): void {
    this.onPointerDown(e);
  }

  override onCancel(): void {
    if (this.drawing) this.editor.cancelGesture();
    this.drawing = null;
    this.editor.setState({ interaction: 'idle' });
  }
}
