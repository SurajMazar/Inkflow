import type { Editor } from '@inkflow/canvas-engine';
import { getCommonBounds, type SceneElement } from '@inkflow/elements';
import type { Point } from '@inkflow/geometry';
import { duplicateElements } from '@inkflow/scene';

/** World point at the center of the visible canvas. */
export function viewportCenterWorld(editor: Editor): Point {
  const vp = editor.state.viewport;
  return editor.screenToWorld({ x: vp.width / 2, y: vp.height / 2 });
}

/** Elements sorted by their fractional z-order key (ties broken by id, like the scene). */
export function sortByIndex(elements: readonly SceneElement[]): SceneElement[] {
  return [...elements].sort((a, b) =>
    a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/**
 * Inserts a self-contained element set (template, import, generated diagram) as new elements:
 * ids, groups and bindings are regenerated with `duplicateElements`, the set is centered at `at`
 * (default: viewport center) and the result is selected. Returns the created elements.
 */
export function insertElementSet(
  editor: Editor,
  elements: readonly SceneElement[],
  options: { at?: Point; label: string; select?: boolean },
): SceneElement[] {
  const live = sortByIndex(elements.filter((e) => !e.isDeleted));
  if (live.length === 0) return [];
  const bounds = getCommonBounds(live);
  const center = options.at ?? viewportCenterWorld(editor);
  const dx = bounds ? center.x - (bounds.minX + bounds.maxX) / 2 : 0;
  const dy = bounds ? center.y - (bounds.minY + bounds.maxY) / 2 : 0;
  const { elements: fresh } = duplicateElements(live, { dx, dy, existingFrameIds: new Set() });
  return editor.addElements(fresh, { label: options.label, select: options.select });
}

/** Normalizes importer issues (plain strings or `{ message }` records) for display. */
export function formatIssue(issue: string | { message: string }): string {
  return typeof issue === 'string' ? issue : issue.message;
}
