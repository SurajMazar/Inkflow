import { panBy } from '../viewport';
import type { CanvasPointerEvent } from '../types';
import { BaseTool } from './base';

/** Pans the viewport by dragging. */
export class HandTool extends BaseTool {
  readonly id = 'hand' as const;
  private last: { x: number; y: number } | null = null;

  override cursor(): string {
    return this.last ? 'grabbing' : 'grab';
  }

  override onPointerDown(e: CanvasPointerEvent): void {
    this.last = e.screen;
    this.editor.setState({ cursor: 'grabbing', interaction: 'panning' });
  }

  override onPointerMove(e: CanvasPointerEvent): void {
    if (!this.last) return;
    const dx = e.screen.x - this.last.x;
    const dy = e.screen.y - this.last.y;
    this.last = e.screen;
    this.editor.setViewport(panBy(this.editor.state.viewport, dx, dy));
  }

  override onPointerUp(): void {
    this.last = null;
    this.editor.setState({ cursor: 'grab', interaction: 'idle' });
  }

  override onDoubleClick(): void {}

  override onCancel(): void {
    this.last = null;
  }

  override isBusy(): boolean {
    return this.last !== null;
  }
}
