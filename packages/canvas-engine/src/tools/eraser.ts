import { hitTestElement, type SceneElement } from '@inkflow/elements';
import type { Point } from '@inkflow/geometry';
import type { InteractiveRenderState } from '@inkflow/renderer';
import { elementOutline } from '../outline';
import type { CanvasPointerEvent } from '../types';
import { BaseTool } from './base';

const ERASER_RADIUS_PX = 10;
const TRAIL_MS = 250;

/** Erases whole elements (and their groups) touched by the eraser trail. */
export class EraserTool extends BaseTool {
  readonly id = 'eraser' as const;
  private active = false;
  private targets = new Set<string>();
  private trail: { p: Point; t: number }[] = [];
  private last: Point | null = null;

  override cursor(): string {
    return 'crosshair';
  }

  override isBusy(): boolean {
    return this.active;
  }

  override onPointerDown(e: CanvasPointerEvent): void {
    if (this.editor.isReadOnly) return;
    this.active = true;
    this.targets.clear();
    this.trail = [{ p: e.world, t: e.timeStamp }];
    this.last = e.world;
    this.editor.setState({ selectedIds: [], interaction: 'erasing' });
    this.collect(e.world, e.world);
    this.editor.invalidate('overlay');
  }

  override onPointerMove(e: CanvasPointerEvent): void {
    if (!this.active || !this.last) return;
    this.collect(this.last, e.world);
    this.last = e.world;
    this.trail.push({ p: e.world, t: e.timeStamp });
    const cutoff = e.timeStamp - TRAIL_MS;
    while (this.trail.length > 2 && this.trail[0]!.t < cutoff) this.trail.shift();
    this.editor.invalidate('overlay');
  }

  private collect(a: Point, b: Point) {
    const r = this.px(ERASER_RADIUS_PX);
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r / 2)));
    const scene = this.editor.scene;
    for (let i = 0; i <= steps; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
      for (const el of scene.queryPoint(p.x, p.y, r)) {
        if (el.locked || el.hidden || this.targets.has(el.id)) continue;
        if (!hitTestElement(el, p, { tolerance: r, areaHitForTransparent: el.type !== 'frame' })) continue;
        this.addTarget(el);
      }
    }
  }

  private addTarget(el: SceneElement) {
    this.targets.add(el.id);
    const group = el.groupIds.at(-1);
    if (group) for (const m of this.editor.scene.getGroupElements(group)) if (!m.locked) this.targets.add(m.id);
  }

  override onPointerUp(): void {
    if (!this.active) return;
    this.active = false;
    const ids = [...this.targets];
    this.targets.clear();
    this.trail = [];
    this.last = null;
    if (ids.length) this.editor.deleteElements(ids, 'Erase');
    this.editor.setState({ interaction: 'idle' });
  }

  override onDoubleClick(e: CanvasPointerEvent): void {
    this.onPointerDown(e);
  }

  override onCancel(): void {
    this.active = false;
    this.targets.clear();
    this.trail = [];
    this.editor.setState({ interaction: 'idle' });
  }

  override onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.active) {
      this.onCancel();
      return true;
    }
    return false;
  }

  override overlay(): Partial<InteractiveRenderState> {
    if (!this.active) return {};
    const outlines: Point[][] = [];
    for (const id of this.targets) {
      const el = this.editor.scene.getLiveElement(id);
      if (el) outlines.push(elementOutline(el));
    }
    return { eraserTrail: this.trail.map((t) => t.p), eraserTargets: outlines };
  }
}
