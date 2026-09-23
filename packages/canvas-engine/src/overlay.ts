import { getOutlinePolygon } from '@inkflow/diagram-engine';
import { isLinearElement, type SceneElement } from '@inkflow/elements';
import type { InteractiveRenderState, RemoteCursor, RemoteSelection } from '@inkflow/renderer';
import type { Editor } from './editor';
import { elementOutline } from './outline';
import {
  computeLinearHandles,
  computeTransformHandles,
  frameCorners,
  getSelectionFrame,
} from './transform/handles';

const ACCENT = '#6965db';

function outlineFor(el: SceneElement) {
  try {
    const poly = getOutlinePolygon(el);
    if (poly.length >= 3) return poly;
  } catch {
    // Fall back to the local outline helper.
  }
  return elementOutline(el);
}

export function emptyOverlay(editor: Editor, pixelRatio = 1): InteractiveRenderState {
  const s = editor.state;
  return {
    viewport: s.viewport,
    pixelRatio,
    theme: s.theme,
    accentColor: ACCENT,
    selectionOutlines: [],
    selectionBox: null,
    groupOutlines: [],
    handles: [],
    marquee: null,
    lasso: null,
    hoverOutline: null,
    snapLines: [],
    snapPoints: [],
    bindingHighlight: null,
    ports: [],
    remoteCursors: [],
    remoteSelections: [],
    eraserTrail: [],
    eraserTargets: [],
    frameHighlight: null,
    linearEditor: null,
    cropEditor: null,
    commentPins: [],
    searchHighlights: [],
    laserTrail: [],
  };
}

/** Assembles everything the interactive canvas should draw for the current editor state. */
export function buildOverlayState(editor: Editor, pixelRatio = 1): InteractiveRenderState {
  const s = editor.state;
  const overlay = emptyOverlay(editor, pixelRatio);
  const presenting = s.presentation.active;
  const selected = editor.getSelectedElements();
  const tool = editor.activeTool;
  const busy = tool.isBusy();
  const interaction = s.interaction;

  if (!presenting && s.tool === 'selection' && !s.textEdit) {
    // Selection chrome
    if (selected.length > 0) {
      const showHandles = !s.readOnly && interaction !== 'moving' && !s.cropId;
      overlay.selectionOutlines =
        selected.length > 1 || isLinearElement(selected[0]!) ? selected.map(outlineFor) : [];
      const single = selected.length === 1 ? selected[0]! : null;
      const lockedAll = selected.every((e) => e.locked);
      if (single && isLinearElement(single)) {
        if (showHandles && !single.locked) {
          overlay.handles = computeLinearHandles(single, {
            endpointsOnly: single.type === 'connector',
          });
          const pts = single.points.length;
          if (pts > 2 && single.type !== 'connector') {
            const frame = getSelectionFrame([single]);
            if (frame) overlay.selectionBox = frameCorners(frame, 4 / s.viewport.zoom);
          }
        }
      } else {
        const frame = getSelectionFrame(selected);
        if (frame) {
          overlay.selectionBox = frameCorners(frame, 4 / s.viewport.zoom);
          if (showHandles && !lockedAll) {
            const hasFrame = selected.some((e) => e.type === 'frame');
            overlay.handles = computeTransformHandles(frame, {
              zoom: s.viewport.zoom,
              rotatable: !hasFrame,
              resizable: true,
            });
          }
        }
      }
      // Group outlines (dashed) for selected groups.
      const groups = new Set<string>();
      for (const el of selected) {
        const g = s.editingGroupId
          ? el.groupIds[el.groupIds.indexOf(s.editingGroupId) - 1]
          : el.groupIds.at(-1);
        if (g) groups.add(g);
      }
      if (selected.length > 1 && groups.size > 1) {
        for (const g of groups) {
          const members = editor.scene.getGroupElements(g);
          const frame = getSelectionFrame(members);
          if (frame) overlay.groupOutlines.push(frameCorners(frame, 2 / s.viewport.zoom));
        }
      }
    }
    if (s.editingGroupId) {
      const members = editor.scene.getGroupElements(s.editingGroupId);
      const frame = getSelectionFrame(members);
      if (frame) overlay.groupOutlines.push(frameCorners(frame, 6 / s.viewport.zoom));
    }
    // Hover highlight
    if (s.hoveredId && !busy && !s.selectedIds.includes(s.hoveredId)) {
      const el = editor.scene.getLiveElement(s.hoveredId);
      if (el) overlay.hoverOutline = outlineFor(el);
    }
  }

  // Crop editor
  if (s.cropId) {
    const el = editor.scene.getLiveElement(s.cropId);
    if (el && el.type === 'image') {
      const crop = el.crop ?? { x: 0, y: 0, width: el.naturalWidth, height: el.naturalHeight };
      const sx = el.width / Math.max(1, crop.width);
      const sy = el.height / Math.max(1, crop.height);
      overlay.cropEditor = {
        imageRect: {
          x: el.x - crop.x * sx,
          y: el.y - crop.y * sy,
          width: el.naturalWidth * sx,
          height: el.naturalHeight * sy,
        },
        cropRect: { x: el.x, y: el.y, width: el.width, height: el.height },
        angle: el.angle,
        center: { x: el.x + el.width / 2, y: el.y + el.height / 2 },
      };
    }
  }

  // Search highlights
  overlay.searchHighlights = s.searchHighlightIds
    .map((id) => editor.scene.getLiveElement(id))
    .filter((e): e is SceneElement => !!e)
    .map((e) => elementOutline(e, 6 / s.viewport.zoom));

  // Collaborators
  const cursors: RemoteCursor[] = [];
  const remoteSelections: RemoteSelection[] = [];
  for (const c of s.collaborators) {
    if (c.cursor) {
      cursors.push({
        clientId: c.clientId,
        name: c.name,
        color: c.color,
        x: c.cursor.x,
        y: c.cursor.y,
        active: c.active,
        tool: c.tool,
      });
    }
    if (c.selectedIds.length && !presenting) {
      const outlines = c.selectedIds
        .map((id) => editor.scene.getLiveElement(id))
        .filter((e): e is SceneElement => !!e)
        .map((e) => elementOutline(e, 3 / s.viewport.zoom));
      if (outlines.length)
        remoteSelections.push({ clientId: c.clientId, name: c.name, color: c.color, outlines });
    }
  }
  overlay.remoteCursors = cursors;
  overlay.remoteSelections = remoteSelections;

  // Tool-specific contributions (marquee, snapping, bindings, eraser, laser…)
  Object.assign(overlay, tool.overlay());
  return overlay;
}
