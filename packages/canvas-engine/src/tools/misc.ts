import type { Point } from '@inkflow/geometry';
import type { InteractiveRenderState } from '@inkflow/renderer';
import { hitTestTop, hitTolerancePx } from '../hit-test';
import type { CanvasPointerEvent } from '../types';
import { BaseTool } from './base';

/** Opens the image picker and inserts the chosen images. */
export class ImageTool extends BaseTool {
  readonly id = 'image' as const;
  private picking = false;

  override activate(): void {
    void this.pick();
  }

  private async pick(at?: Point) {
    if (this.picking) return;
    const host = this.editor.host;
    if (!host.pickImages) {
      this.editor.requestUi({
        type: 'toast',
        level: 'error',
        message: 'Image upload is not available here.',
      });
      this.editor.setTool('selection');
      return;
    }
    this.picking = true;
    try {
      const files = await host.pickImages();
      if (files.length) await this.editor.insertImageFiles(files, at);
    } catch (error) {
      this.editor.host.onError?.(error, 'Insert image');
    } finally {
      this.picking = false;
      if (this.editor.state.tool === 'image') this.editor.setTool('selection');
    }
  }

  override onPointerDown(e: CanvasPointerEvent): void {
    void this.pick(e.world);
  }
}

/** Places a comment at a point or on an element. */
export class CommentTool extends BaseTool {
  readonly id = 'comment' as const;

  override cursor(): string {
    return 'copy';
  }

  override onPointerDown(e: CanvasPointerEvent): void {
    const hit = hitTestTop(this.editor.scene, e.world, {
      tolerance: hitTolerancePx(e.pointerType) / this.zoom,
      includeLocked: true,
    });
    this.editor.requestUi({ type: 'comment', world: e.world, elementId: hit?.id ?? null });
  }
}

const LASER_FADE_MS = 900;

/** Presenter laser pointer: a fading trail, never persisted. */
export class LaserTool extends BaseTool {
  readonly id = 'laser' as const;
  private trail: { p: Point; t: number }[] = [];
  private down = false;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  override cursor(): string {
    return 'crosshair';
  }

  override onPointerDown(e: CanvasPointerEvent): void {
    this.down = true;
    this.trail.push({ p: e.world, t: performance.now() });
    this.editor.setOverlayAnimating(true);
  }

  override onPointerMove(e: CanvasPointerEvent): void {
    if (!this.down) return;
    this.trail.push({ p: e.world, t: performance.now() });
  }

  override onPointerUp(): void {
    this.down = false;
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => {
      this.trail = [];
      this.editor.setOverlayAnimating(false);
      this.editor.invalidate('overlay');
    }, LASER_FADE_MS + 50);
  }

  override onDoubleClick(e: CanvasPointerEvent): void {
    this.onPointerDown(e);
  }

  override deactivate(): void {
    this.trail = [];
    this.down = false;
    this.editor.setOverlayAnimating(false);
  }

  override overlay(): Partial<InteractiveRenderState> {
    const now = performance.now();
    this.trail = this.trail.filter((t) => now - t.t < LASER_FADE_MS);
    return { laserTrail: this.trail.map((t) => t.p) };
  }
}
