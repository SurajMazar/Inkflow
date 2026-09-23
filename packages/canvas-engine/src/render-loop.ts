import type { InteractiveRenderer, StaticRenderer } from '@inkflow/renderer';
import type { Editor } from './editor';
import { buildOverlayState } from './overlay';
import { visibleWorldBounds } from './viewport';

/** Culling margin in screen pixels (covers stroke widths, arrowheads and roughness). */
const CULL_MARGIN_PX = 120;

/**
 * Batches redraw requests into animation frames and only redraws the layers that changed:
 * the static scene canvas (elements) and the interactive overlay (selection, cursors…).
 */
export class RenderLoop {
  private staticDirty = true;
  private overlayDirty = true;
  private frame: number | null = null;
  private disposed = false;
  private animating = false;
  /** Last static render cost; used to enable low-fidelity mode for huge scenes while panning. */
  private lastStaticMs = 0;
  private lastViewportKey = '';

  constructor(
    private readonly editor: Editor,
    private readonly staticRenderer: StaticRenderer,
    private readonly interactiveRenderer: InteractiveRenderer,
  ) {}

  request(layer: 'static' | 'overlay' | 'all'): void {
    if (this.disposed) return;
    if (layer !== 'overlay') this.staticDirty = true;
    if (layer !== 'static') this.overlayDirty = true;
    if (this.frame === null) this.frame = requestAnimationFrame(this.tick);
  }

  /** Keeps rendering the overlay every frame while `active` (laser trails, eraser fade). */
  setAnimating(active: boolean): void {
    this.animating = active;
    if (active) this.request('overlay');
  }

  private tick = () => {
    this.frame = null;
    if (this.disposed) return;
    const state = this.editor.state;
    const viewport = state.viewport;
    const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    if (this.staticDirty) {
      this.staticDirty = false;
      const margin = CULL_MARGIN_PX / viewport.zoom;
      const visible = this.editor.scene.queryBounds(visibleWorldBounds(viewport, margin));
      const skipIds = new Set<string>();
      const edit = state.textEdit;
      if (edit?.kind === 'text') skipIds.add(edit.elementId);
      const viewportKey = `${viewport.x}:${viewport.y}:${viewport.zoom}`;
      const panning = viewportKey !== this.lastViewportKey && this.editor.state.interaction === 'panning';
      this.lastViewportKey = viewportKey;
      const stats = this.staticRenderer.render(visible, {
        viewport,
        pixelRatio,
        background: state.viewBackgroundColor,
        grid: state.grid,
        theme: state.theme,
        images: this.editor.images,
        skipIds,
        editingLabelId: edit && edit.kind !== 'text' ? edit.elementId : null,
        showFrameNames: state.showFrameNames && !state.presentation.active,
        lowFidelity: panning && this.lastStaticMs > 12,
        getElement: (id) => this.editor.scene.getLiveElement(id),
      });
      this.lastStaticMs = stats.durationMs;
    }
    if (this.overlayDirty || this.animating) {
      this.overlayDirty = false;
      this.interactiveRenderer.render(buildOverlayState(this.editor, pixelRatio));
    }
    if (this.animating) this.frame = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
