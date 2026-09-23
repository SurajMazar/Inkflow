import type { Editor } from '@inkflow/canvas-engine';
import { LIBRARY_ITEMS, type LibraryItem } from '@inkflow/diagram-engine';
import type { Point } from '@inkflow/geometry';

/** Drag payload MIME type of library items (value: the library item id). */
export const LIBRARY_DRAG_MIME = 'application/x-inkflow-library';

export function findLibraryItem(id: string): LibraryItem | undefined {
  return LIBRARY_ITEMS.find((item) => item.id === id);
}

/** Starts an HTML5 drag carrying a library item. */
export function startLibraryDrag(dataTransfer: DataTransfer, itemId: string): void {
  dataTransfer.setData(LIBRARY_DRAG_MIME, itemId);
  dataTransfer.effectAllowed = 'copy';
}

/**
 * Handles a drop on the canvas. Returns true when the drop carried a library item (it is then
 * inserted centered at `world`), false for any other payload so the caller can handle files.
 */
export function handleLibraryDrop(editor: Editor, dataTransfer: DataTransfer, world: Point): boolean {
  if (!dataTransfer.types.includes(LIBRARY_DRAG_MIME)) return false;
  const id = dataTransfer.getData(LIBRARY_DRAG_MIME);
  const item = id ? findLibraryItem(id) : undefined;
  if (!item || editor.isReadOnly) return true;
  editor.addElements(item.create(world), { label: `Insert ${item.name}` });
  return true;
}
