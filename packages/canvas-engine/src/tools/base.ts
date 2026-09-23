import { getElementBounds } from '@inkflow/elements';
import type { Bounds, Point } from '@inkflow/geometry';
import type { InteractiveRenderState } from '@inkflow/renderer';
import type { Editor } from '../editor';
import {
  SNAP_THRESHOLD_PX,
  snapPointToGrid,
  snapPointToObjects,
  type SnapGuides,
} from '../snapping';
import type { CanvasPointerEvent, ToolType } from '../types';
import { visibleWorldBounds } from '../viewport';

export interface Tool {
  readonly id: ToolType;
  cursor(): string;
  activate(): void;
  deactivate(): void;
  onPointerDown(e: CanvasPointerEvent): void;
  onPointerMove(e: CanvasPointerEvent): void;
  onPointerUp(e: CanvasPointerEvent): void;
  onDoubleClick(e: CanvasPointerEvent): void;
  /** Aborts the current interaction (Escape, pointer cancel, second touch). */
  onCancel(): void;
  /** Returns true when the key was consumed. */
  onKeyDown(e: KeyboardEvent): boolean;
  /** Overlay contributions merged into the interactive render state. */
  overlay(): Partial<InteractiveRenderState>;
  /** True while an interaction is in progress. */
  isBusy(): boolean;
}

export abstract class BaseTool implements Tool {
  abstract readonly id: ToolType;

  constructor(protected readonly editor: Editor) {}

  cursor(): string {
    return 'crosshair';
  }
  activate(): void {}
  deactivate(): void {
    this.onCancel();
  }
  onPointerDown(_e: CanvasPointerEvent): void {}
  onPointerMove(_e: CanvasPointerEvent): void {}
  onPointerUp(_e: CanvasPointerEvent): void {}
  onDoubleClick(e: CanvasPointerEvent): void {
    this.onPointerDown(e);
  }
  onCancel(): void {}
  onKeyDown(_e: KeyboardEvent): boolean {
    return false;
  }
  overlay(): Partial<InteractiveRenderState> {
    return {};
  }
  isBusy(): boolean {
    return false;
  }

  protected get zoom(): number {
    return this.editor.state.viewport.zoom;
  }

  /** Converts a screen-pixel distance to world units at the current zoom. */
  protected px(n: number): number {
    return n / this.zoom;
  }
}

/** Bounds of visible, unselected elements used as snapping targets. */
export function snapCandidates(
  editor: Editor,
  exclude: ReadonlySet<string>,
  limit = 400,
): Bounds[] {
  const visible = editor.scene.queryBounds(visibleWorldBounds(editor.state.viewport));
  const out: Bounds[] = [];
  for (const el of visible) {
    if (exclude.has(el.id) || el.hidden) continue;
    if (el.type === 'freedraw') continue;
    out.push(getElementBounds(el));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Snaps a world point for drawing: grid first (when enabled), otherwise object edges/centers.
 * `invert` (Mod held) toggles object snapping for this move.
 */
export function snapDrawingPoint(
  editor: Editor,
  p: Point,
  exclude: ReadonlySet<string>,
  invert = false,
): { point: Point } & SnapGuides {
  const { snapping, grid, viewport } = editor.state;
  if (snapping.toGrid) return { point: snapPointToGrid(p, grid.size), lines: [], points: [] };
  if (snapping.toObjects !== invert) {
    return snapPointToObjects(
      p,
      snapCandidates(editor, exclude),
      SNAP_THRESHOLD_PX / viewport.zoom,
    );
  }
  return { point: p, lines: [], points: [] };
}

export const DRAG_THRESHOLD_PX: Record<CanvasPointerEvent['pointerType'], number> = {
  mouse: 3,
  pen: 4,
  touch: 7,
};
