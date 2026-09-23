import { hasShapeLabel, isLinearElement } from '@inkflow/elements';
import { hitTestTop, hitTolerancePx } from '../hit-test';
import type { CanvasPointerEvent } from '../types';
import { BaseTool, snapDrawingPoint } from './base';

/** Creates text elements or edits existing text/labels under the pointer. */
export class TextTool extends BaseTool {
  readonly id = 'text' as const;

  override cursor(): string {
    return 'text';
  }

  override onPointerDown(e: CanvasPointerEvent): void {
    const editor = this.editor;
    if (editor.isReadOnly) return;
    editor.commitTextEditIfAny();
    const hit = hitTestTop(editor.scene, e.world, { tolerance: hitTolerancePx(e.pointerType) / this.zoom });
    if (hit?.type === 'text') {
      editor.startTextEdit(hit.id, 'text');
    } else if (hit && hasShapeLabel(hit)) {
      editor.startTextEdit(hit.id, 'label');
    } else if (hit && isLinearElement(hit)) {
      editor.startTextEdit(hit.id, 'edge-label');
    } else {
      editor.createTextAt(snapDrawingPoint(editor, e.world, new Set(), e.mod).point);
    }
    if (!editor.state.toolLocked) editor.setState({ tool: 'selection', cursor: 'default' });
  }

  override onDoubleClick(e: CanvasPointerEvent): void {
    this.onPointerDown(e);
  }
}
