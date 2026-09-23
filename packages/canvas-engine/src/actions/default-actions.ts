import {
  autoLayout,
  computeConnectorRoute,
  createConnector,
  createNode,
  selectConnectedComponent,
  type AutoLayoutKind,
} from '@inkflow/diagram-engine';
import {
  createElement,
  getCommonBounds,
  getElementBounds,
  isLinearElement,
  measureTextElement,
  type ElementPatch,
  type NodeElement,
} from '@inkflow/elements';
import { boundsCenter } from '@inkflow/geometry';
import {
  alignElements,
  computeZOrder,
  distributeElements,
  groupElementsPatches,
  ungroupElementsPatches,
  duplicateElements,
  generateKeyBetween,
  type AlignMode,
  type ZOrderAction,
} from '@inkflow/scene';
import type { Editor } from '../editor';
import { flipElements } from '../transform/rotate';
import type { ToolType } from '../types';
import type { ActionRegistry } from './registry';

const hasSelection = (e: Editor) => e.state.selectedIds.length > 0;
const hasUnlockedSelection = (e: Editor) => e.getSelectedElements().some((el) => !el.locked);
const unlocked = (e: Editor) => e.getSelectedElements().filter((el) => !el.locked);

const TOOLS: ToolType[] = [
  'selection',
  'hand',
  'rectangle',
  'roundedRectangle',
  'ellipse',
  'diamond',
  'triangle',
  'polygon',
  'star',
  'line',
  'arrow',
  'connector',
  'pencil',
  'brush',
  'highlighter',
  'eraser',
  'text',
  'image',
  'frame',
  'node',
  'comment',
  'laser',
];
const READONLY_TOOLS = new Set<ToolType>(['selection', 'hand', 'laser', 'comment']);

export function registerDefaultActions(registry: ActionRegistry): void {
  const r = registry;

  // ───────── tools ─────────
  for (const tool of TOOLS) {
    r.register({
      id: `tool.${tool}`,
      label: tool,
      readOnlySafe: READONLY_TOOLS.has(tool),
      checked: (e) => e.state.tool === tool,
      perform: (e) => e.setTool(tool),
    });
  }
  r.register({
    id: 'tool.lock',
    label: 'Keep tool active',
    checked: (e) => e.state.toolLocked,
    perform: (e) => e.setState({ toolLocked: !e.state.toolLocked }),
  });

  // ───────── edit ─────────
  r.register({ id: 'edit.undo', label: 'Undo', enabled: (e) => e.state.canUndo, perform: (e) => e.undo() });
  r.register({ id: 'edit.redo', label: 'Redo', enabled: (e) => e.state.canRedo, perform: (e) => e.redo() });
  r.register({ id: 'edit.copy', label: 'Copy', readOnlySafe: true, enabled: hasSelection, perform: (e) => void e.clipboard.copy() });
  r.register({ id: 'edit.cut', label: 'Cut', enabled: hasUnlockedSelection, perform: (e) => void e.clipboard.cut() });
  r.register({ id: 'edit.paste', label: 'Paste', perform: (e) => void e.clipboard.paste() });
  r.register({ id: 'edit.pasteInPlace', label: 'Paste in place', perform: (e) => void e.clipboard.paste({ inPlace: true }) });
  r.register({
    id: 'edit.duplicate',
    label: 'Duplicate',
    enabled: hasUnlockedSelection,
    perform: (e) => {
      const selected = unlocked(e);
      const withChildren = new Map(selected.map((el) => [el.id, el]));
      for (const el of selected) if (el.type === 'frame') for (const c of e.scene.getFrameChildren(el.id)) withChildren.set(c.id, c);
      const offset = 16 / Math.max(0.1, e.state.viewport.zoom);
      const frameIds = new Set(e.getFrames().map((f) => f.id));
      const { elements, idMap } = duplicateElements([...withChildren.values()], { dx: offset, dy: offset, existingFrameIds: frameIds });
      e.addElements(elements, { label: 'Duplicate', select: false });
      e.setState({ selectedIds: selected.map((s) => idMap.get(s.id)!).filter(Boolean) });
    },
  });
  r.register({
    id: 'edit.delete',
    label: 'Delete',
    enabled: hasUnlockedSelection,
    perform: (e) => e.deleteElements(e.state.selectedIds),
  });
  r.register({ id: 'edit.selectAll', label: 'Select all', readOnlySafe: true, perform: (e) => e.selectAll() });
  r.register({
    id: 'edit.deselect',
    label: 'Deselect',
    readOnlySafe: true,
    perform: (e) => {
      if (e.state.presentation.active) return e.stopPresentation();
      if (e.state.contextMenu) return e.closeContextMenu();
      if (e.state.tool !== 'selection') return e.setTool('selection');
      e.clearSelection();
      e.setState({ searchHighlightIds: [] });
    },
  });
  r.register({ id: 'edit.copyStyles', label: 'Copy styles', enabled: hasSelection, readOnlySafe: true, perform: (e) => e.clipboard.copyStyles() });
  r.register({
    id: 'edit.pasteStyles',
    label: 'Paste styles',
    enabled: (e) => hasUnlockedSelection(e) && e.clipboard.hasCopiedStyle,
    perform: (e) => e.clipboard.pasteStyles(),
  });
  r.register({ id: 'edit.find', label: 'Find on canvas', readOnlySafe: true, perform: (e) => e.requestUi({ type: 'find' }) });

  // ───────── arrange ─────────
  r.register({
    id: 'arrange.group',
    label: 'Group',
    enabled: (e) => unlocked(e).length > 1,
    perform: (e) => {
      const els = unlocked(e);
      const { patches } = groupElementsPatches(els);
      e.updateElements(patches.map(([id, p]) => [id, { groupIds: [...p.groupIds] }] as const), 'Group');
      e.setState({ selectedIds: els.map((x) => x.id) });
    },
  });
  r.register({
    id: 'arrange.ungroup',
    label: 'Ungroup',
    enabled: (e) => e.getSelectedElements().some((el) => el.groupIds.length > 0 && !el.locked),
    perform: (e) => {
      const els = unlocked(e);
      const { patches } = ungroupElementsPatches(els);
      e.updateElements(patches, 'Ungroup');
      e.setState({ editingGroupId: null });
    },
  });
  const zorder = (id: string, label: string, action: ZOrderAction) =>
    r.register({
      id,
      label,
      enabled: hasUnlockedSelection,
      perform: (e) => {
        const map = computeZOrder(e.scene.getElements(), new Set(unlocked(e).map((x) => x.id)), action);
        e.updateElements([...map.entries()].map(([elId, index]) => [elId, { index }] as const), label);
      },
    });
  zorder('arrange.bringForward', 'Bring forward', 'bringForward');
  zorder('arrange.sendBackward', 'Send backward', 'sendBackward');
  zorder('arrange.bringToFront', 'Bring to front', 'bringToFront');
  zorder('arrange.sendToBack', 'Send to back', 'sendToBack');

  r.register({
    id: 'arrange.lock',
    label: 'Lock / unlock',
    enabled: hasSelection,
    checked: (e) => e.getSelectedElements().length > 0 && e.getSelectedElements().every((el) => el.locked),
    perform: (e) => {
      const els = e.getSelectedElements();
      const lock = !els.every((el) => el.locked);
      e.updateElements(els.map((el) => [el.id, { locked: lock }] as const), lock ? 'Lock' : 'Unlock');
      if (lock) e.clearSelection();
    },
  });
  r.register<{ ids?: string[] }>({
    id: 'arrange.unlock',
    label: 'Unlock',
    perform: (e, payload) => {
      const ids = payload?.ids ?? (e.state.contextMenu?.elementId ? [e.state.contextMenu.elementId] : e.state.selectedIds);
      e.updateElements(ids.map((id) => [id, { locked: false }] as const), 'Unlock');
      e.select(ids);
    },
  });
  r.register({
    id: 'arrange.unlockAll',
    label: 'Unlock all',
    enabled: (e) => e.getElements().some((el) => el.locked),
    perform: (e) => {
      const locked = e.getElements().filter((el) => el.locked);
      e.updateElements(locked.map((el) => [el.id, { locked: false }] as const), 'Unlock all');
      e.select(locked.map((el) => el.id), { expandGroups: false });
    },
  });
  r.register({
    id: 'arrange.hide',
    label: 'Hide',
    enabled: hasUnlockedSelection,
    perform: (e) => {
      e.updateElements(unlocked(e).map((el) => [el.id, { hidden: true }] as const), 'Hide');
      e.clearSelection();
    },
  });
  r.register<{ ids?: string[] }>({
    id: 'arrange.show',
    label: 'Show',
    perform: (e, payload) => {
      const ids = payload?.ids ?? [];
      e.updateElements(ids.map((id) => [id, { hidden: false }] as const), 'Show');
    },
  });
  r.register({
    id: 'arrange.showAll',
    label: 'Show hidden elements',
    enabled: (e) => e.getElements().some((el) => el.hidden),
    perform: (e) => {
      const hidden = e.getElements().filter((el) => el.hidden);
      e.updateElements(hidden.map((el) => [el.id, { hidden: false }] as const), 'Show all');
      e.select(hidden.map((el) => el.id), { expandGroups: false });
    },
  });
  const flip = (id: string, label: string, axis: 'horizontal' | 'vertical') =>
    r.register({
      id,
      label,
      enabled: hasUnlockedSelection,
      perform: (e) => {
        const els = unlocked(e);
        const center = boundsCenter(getCommonBounds(els)!);
        const patches = flipElements(els, axis, center);
        e.mutate(label, (tx) => {
          tx.updateMany([...patches.entries()]);
          e.refreshBindings(tx, patches.keys());
        });
      },
    });
  flip('arrange.flipHorizontal', 'Flip horizontal', 'horizontal');
  flip('arrange.flipVertical', 'Flip vertical', 'vertical');

  const align = (id: string, label: string, mode: AlignMode) =>
    r.register({
      id,
      label,
      enabled: (e) => unlocked(e).length > 1,
      perform: (e) => {
        const patches = alignElements(unlocked(e), mode, e.state.editingGroupId);
        e.updateElements(patches, label);
      },
    });
  align('arrange.alignLeft', 'Align left', 'left');
  align('arrange.alignCenter', 'Align center', 'center');
  align('arrange.alignRight', 'Align right', 'right');
  align('arrange.alignTop', 'Align top', 'top');
  align('arrange.alignMiddle', 'Align middle', 'middle');
  align('arrange.alignBottom', 'Align bottom', 'bottom');
  const distribute = (id: string, label: string, mode: 'horizontal' | 'vertical') =>
    r.register({
      id,
      label,
      enabled: (e) => unlocked(e).length > 2,
      perform: (e) => e.updateElements(distributeElements(unlocked(e), mode, e.state.editingGroupId), label),
    });
  distribute('arrange.distributeHorizontal', 'Distribute horizontally', 'horizontal');
  distribute('arrange.distributeVertical', 'Distribute vertically', 'vertical');

  // ───────── frames ─────────
  r.register<{ frameId: string }>({
    id: 'frame.addSelection',
    label: 'Add to frame',
    enabled: (e) => hasUnlockedSelection(e) && e.getFrames().length > 0,
    perform: (e, payload) => {
      const frameId = payload?.frameId ?? e.getFrames().at(-1)?.id;
      if (!frameId) return;
      const els = unlocked(e).filter((el) => el.type !== 'frame');
      e.updateElements(els.map((el) => [el.id, { frameId }] as const), 'Add to frame');
    },
  });
  r.register({
    id: 'frame.removeSelection',
    label: 'Remove from frame',
    enabled: (e) => e.getSelectedElements().some((el) => el.frameId),
    perform: (e) => e.updateElements(unlocked(e).filter((el) => el.frameId).map((el) => [el.id, { frameId: null }] as const), 'Remove from frame'),
  });
  r.register({
    id: 'frame.wrapSelection',
    label: 'Wrap selection in frame',
    enabled: (e) => unlocked(e).filter((el) => el.type !== 'frame').length > 0,
    perform: (e) => {
      const els = unlocked(e).filter((el) => el.type !== 'frame');
      const b = getCommonBounds(els)!;
      const pad = 32;
      const count = e.getFrames().length + 1;
      e.mutate('Wrap in frame', (tx) => {
        const frame = createElement('frame', {
          x: b.minX - pad,
          y: b.minY - pad,
          width: b.maxX - b.minX + pad * 2,
          height: b.maxY - b.minY + pad * 2,
          name: `Frame ${count}`,
        });
        // Frames go underneath existing content.
        const lowest = e.scene.getElementsIncludingDeleted()[0]?.index ?? null;
        const created = tx.create({ ...frame, index: generateKeyBetween(null, lowest) });
        tx.updateMany(els.map((el) => [el.id, { frameId: created.id }] as const));
        e.setState({ selectedIds: [created.id] });
      });
    },
  });
  r.register<{ frameId: string }>({
    id: 'frame.zoomTo',
    label: 'Zoom to frame',
    readOnlySafe: true,
    perform: (e, payload) => {
      const frame = payload?.frameId ? e.getElement(payload.frameId) : e.getSelectedElements().find((el) => el.type === 'frame');
      if (frame) e.fitToBounds(getElementBounds(frame), { padding: 32, maxZoom: 4 });
    },
  });

  // ───────── view ─────────
  r.register({ id: 'view.zoomIn', label: 'Zoom in', readOnlySafe: true, perform: (e) => e.zoomIn() });
  r.register({ id: 'view.zoomOut', label: 'Zoom out', readOnlySafe: true, perform: (e) => e.zoomOut() });
  r.register({ id: 'view.resetZoom', label: 'Reset zoom', readOnlySafe: true, perform: (e) => e.resetZoom() });
  r.register({ id: 'view.fitContent', label: 'Zoom to fit all', readOnlySafe: true, perform: (e) => e.fitToContent() });
  r.register({ id: 'view.fitSelection', label: 'Zoom to selection', readOnlySafe: true, perform: (e) => e.fitToSelection() });
  r.register({
    id: 'view.toggleGrid',
    label: 'Show grid',
    readOnlySafe: true,
    checked: (e) => e.state.grid.visible,
    perform: (e) => e.setState({ grid: { ...e.state.grid, visible: !e.state.grid.visible } }),
  });
  r.register({
    id: 'view.toggleSnap',
    label: 'Snap to objects',
    readOnlySafe: true,
    checked: (e) => e.state.snapping.toObjects,
    perform: (e) => e.setState({ snapping: { ...e.state.snapping, toObjects: !e.state.snapping.toObjects } }),
  });
  r.register({
    id: 'view.toggleGridSnap',
    label: 'Snap to grid',
    readOnlySafe: true,
    checked: (e) => e.state.snapping.toGrid,
    perform: (e) => e.setState({ snapping: { ...e.state.snapping, toGrid: !e.state.snapping.toGrid } }),
  });
  r.register({
    id: 'view.toggleTheme',
    label: 'Dark mode',
    readOnlySafe: true,
    checked: (e) => e.state.theme === 'dark',
    perform: (e) => e.requestUi({ type: 'toggle-theme' }),
  });
  r.register({
    id: 'view.zenMode',
    label: 'Zen mode',
    readOnlySafe: true,
    checked: (e) => e.state.zenMode,
    perform: (e) => e.setState({ zenMode: !e.state.zenMode }),
  });
  r.register({ id: 'view.present', label: 'Present', readOnlySafe: true, perform: (e) => e.startPresentation() });
  r.register({ id: 'view.shortcuts', label: 'Keyboard shortcuts', readOnlySafe: true, perform: (e) => e.requestUi({ type: 'shortcuts' }) });
  r.register({ id: 'view.commandPalette', label: 'Command palette', readOnlySafe: true, perform: (e) => e.requestUi({ type: 'command-palette' }) });
  r.register({
    id: 'view.toggleFrameNames',
    label: 'Show frame names',
    readOnlySafe: true,
    checked: (e) => e.state.showFrameNames,
    perform: (e) => e.setState({ showFrameNames: !e.state.showFrameNames }),
  });

  // ───────── text ─────────
  const textToggle = (id: string, label: string, key: 'fontWeight' | 'fontStyle' | 'textDecoration', on: string, off: string) =>
    r.register({
      id,
      label,
      perform: (e) => {
        const els = e.getSelectedElements();
        const current = els.map((el) => (el.type === 'text' ? el[key] : 'label' in el && el.label ? el.label[key] : e.state.style[key]));
        const value = current.length > 0 && current.every((v) => v === on) ? off : on;
        e.applyStyle({ [key]: value }, { [key]: value } as ElementPatch);
      },
    });
  textToggle('text.bold', 'Bold', 'fontWeight', 'bold', 'normal');
  textToggle('text.italic', 'Italic', 'fontStyle', 'italic', 'normal');
  textToggle('text.underline', 'Underline', 'textDecoration', 'underline', 'none');
  const sizeStep = (id: string, label: string, dir: 1 | -1) =>
    r.register({
      id,
      label,
      perform: (e) => {
        const els = unlocked(e);
        const patches = els.flatMap((el): (readonly [string, ElementPatch])[] => {
          if (el.type === 'text') {
            const fontSize = Math.max(4, Math.min(400, Math.round(el.fontSize * (dir > 0 ? 1.15 : 1 / 1.15))));
            const size = measureTextElement({ ...el, fontSize });
            return [[el.id, { fontSize, width: el.autoResize ? size.width : el.width, height: size.height }]];
          }
          if ('label' in el && el.label && !isLinearElement(el)) {
            return [[el.id, { label: { ...el.label, fontSize: Math.max(4, Math.round(el.label.fontSize * (dir > 0 ? 1.15 : 1 / 1.15))) } }]];
          }
          return [];
        });
        e.updateElements(patches, label);
      },
    });
  sizeStep('text.increaseSize', 'Increase font size', 1);
  sizeStep('text.decreaseSize', 'Decrease font size', -1);

  // ───────── navigation ─────────
  const nudge = (id: string, label: string, dx: number, dy: number) =>
    r.register<{ large?: boolean }>({
      id,
      label,
      enabled: hasUnlockedSelection,
      perform: (e, payload) => {
        const step = payload?.large ? (e.state.snapping.toGrid ? e.state.grid.size : 10) : e.state.snapping.toGrid ? e.state.grid.size : 1;
        const els = unlocked(e);
        const withChildren = new Map(els.map((el) => [el.id, el]));
        for (const el of els) if (el.type === 'frame') for (const c of e.scene.getFrameChildren(el.id)) if (!c.locked) withChildren.set(c.id, c);
        e.mutate(
          'Nudge',
          (tx) => {
            tx.updateMany([...withChildren.values()].map((el) => [el.id, { x: el.x + dx * step, y: el.y + dy * step }] as const));
            e.refreshBindings(tx, withChildren.keys());
          },
          { merge: e.history.peekUndo()?.label === 'Nudge' && Date.now() - (e.history.peekUndo()?.timestamp ?? 0) < 1000 },
        );
      },
    });
  nudge('nav.nudgeLeft', 'Nudge left', -1, 0);
  nudge('nav.nudgeRight', 'Nudge right', 1, 0);
  nudge('nav.nudgeUp', 'Nudge up', 0, -1);
  nudge('nav.nudgeDown', 'Nudge down', 0, 1);
  const cycle = (id: string, label: string, dir: 1 | -1) =>
    r.register({
      id,
      label,
      readOnlySafe: true,
      perform: (e) => {
        const els = e.getElements().filter((el) => !el.hidden);
        if (els.length === 0) return;
        const current = e.state.selectedIds[0];
        const idx = current ? els.findIndex((el) => el.id === current) : -1;
        const next = els[(idx + dir + els.length) % els.length]!;
        e.setState({ selectedIds: [next.id] });
        e.focusElement(next.id);
      },
    });
  cycle('nav.nextElement', 'Select next element', 1);
  cycle('nav.previousElement', 'Select previous element', -1);
  r.register({
    id: 'nav.editSelected',
    label: 'Edit selected',
    enabled: (e) => e.state.selectedIds.length === 1,
    perform: (e) => {
      const el = e.getSelectedElements()[0];
      if (!el) return;
      if (el.type === 'text') e.startTextEdit(el.id, 'text');
      else if (el.type === 'frame') e.startTextEdit(el.id, 'frame-name');
      else if (isLinearElement(el)) e.startTextEdit(el.id, 'edge-label');
      else if (el.type === 'table' || el.type === 'uml-class' || el.type === 'sequence') {
        e.setState({ structuredEditId: el.id });
        e.requestUi({ type: 'structured-edit', elementId: el.id });
      } else if (el.type === 'image') e.setState({ cropId: el.id });
      else if ('label' in el) e.startTextEdit(el.id, 'label');
    },
  });
  r.register({
    id: 'element.link',
    label: 'Add link',
    enabled: (e) => e.state.selectedIds.length === 1,
    perform: (e) => e.requestUi({ type: 'link', elementId: e.state.selectedIds[0]! }),
  });

  // ───────── diagram ─────────
  r.register<{ kind?: AutoLayoutKind; direction?: 'TB' | 'LR' | 'BT' | 'RL' }>({
    id: 'diagram.autoLayout',
    label: 'Auto layout',
    enabled: (e) => e.getSelectedElements().filter((el) => !isLinearElement(el)).length > 1,
    perform: (e, payload) => {
      if (!payload?.kind) return e.requestUi({ type: 'auto-layout' });
      const selected = e.getSelectedElements();
      const nodes = selected.filter((el) => !isLinearElement(el) && el.type !== 'freedraw' && !el.locked);
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = e
        .getElements()
        .filter(isLinearElement)
        .filter((l) => l.startBinding && l.endBinding && nodeIds.has(l.startBinding.elementId) && nodeIds.has(l.endBinding.elementId));
      const positions = autoLayout(nodes, edges, payload.kind, { direction: payload.direction });
      e.mutate('Auto layout', (tx) => {
        tx.updateMany([...positions.entries()].map(([id, p]) => [id, { x: p.x, y: p.y }] as const));
        e.refreshBindings(tx, positions.keys());
      });
    },
  });
  r.register({
    id: 'diagram.selectConnected',
    label: 'Select connected',
    readOnlySafe: true,
    enabled: hasSelection,
    perform: (e) => e.setState({ selectedIds: selectConnectedComponent(e.scene, e.state.selectedIds) }),
  });
  r.register<{ direction?: 'right' | 'down' | 'left' | 'up' }>({
    id: 'diagram.addConnected',
    label: 'Add connected node',
    enabled: (e) => e.getSelectedElements().length === 1 && !isLinearElement(e.getSelectedElements()[0]!),
    perform: (e, payload) => addConnectedNode(e, payload?.direction ?? 'right'),
  });
  r.register({ id: 'diagram.library', label: 'Shape library', readOnlySafe: false, perform: (e) => e.requestUi({ type: 'library' }) });

  // ───────── export ─────────
  r.register({ id: 'export.board', label: 'Export board', readOnlySafe: true, perform: (e) => e.requestUi({ type: 'export', scope: 'board' }) });
  r.register({
    id: 'export.selection',
    label: 'Export selection',
    readOnlySafe: true,
    enabled: hasSelection,
    perform: (e) => e.requestUi({ type: 'export', scope: 'selection' }),
  });
  r.register<{ frameId?: string }>({
    id: 'export.frame',
    label: 'Export frame',
    readOnlySafe: true,
    enabled: (e) => e.getSelectedElements().some((el) => el.type === 'frame'),
    perform: (e, payload) =>
      e.requestUi({ type: 'export', scope: 'frame', frameId: payload?.frameId ?? e.getSelectedElements().find((el) => el.type === 'frame')?.id }),
  });
}


/** Creates a node next to the selected one and connects them (mind-map/flowchart style). */
function addConnectedNode(e: Editor, direction: 'right' | 'down' | 'left' | 'up') {
  const source = e.getSelectedElements()[0];
  if (!source) return;
  const gap = 80;
  const width = source.width || 160;
  const height = source.height || 80;
  const existing = e.scene.getBoundLinears(source.id).length;
  const offset = existing * (direction === 'right' || direction === 'left' ? height + 24 : width + 24) * 0.5;
  const pos = {
    right: { x: source.x + source.width + gap, y: source.y + offset },
    left: { x: source.x - gap - width, y: source.y + offset },
    down: { x: source.x + offset, y: source.y + source.height + gap },
    up: { x: source.x + offset, y: source.y - gap - height },
  }[direction];
  const shape = source.type === 'node' ? (source as NodeElement).shape : e.state.style.nodeShape;
  const node = createNode(shape, {
    x: pos.x,
    y: pos.y,
    width,
    height,
    strokeColor: source.strokeColor,
    backgroundColor: source.backgroundColor,
    roughness: source.roughness,
    fillStyle: source.fillStyle,
    label: '',
  });
  const fromPort = { right: 'right', left: 'left', down: 'bottom', up: 'top' }[direction];
  const toPort = { right: 'left', left: 'right', down: 'top', up: 'bottom' }[direction];
  const connector = createConnector(source, node, {
    fromPort,
    toPort,
    routing: e.state.style.connectorRouting,
    strokeColor: source.strokeColor,
  });
  const last = e.scene.getElementsIncludingDeleted().at(-1)?.index ?? null;
  const i1 = generateKeyBetween(last, null);
  const i2 = generateKeyBetween(i1, null);
  e.mutate('Add connected node', (tx) => {
    tx.create({ ...node, index: i1 });
    const createdConnector = tx.create({ ...connector, index: i2 });
    const route = computeConnectorRoute(createdConnector as typeof connector, (id) => e.scene.getLiveElement(id), []);
    tx.update(createdConnector.id, route);
  });
  e.setState({ selectedIds: [node.id] });
  e.startTextEdit(node.id, 'label', { isNew: false });
}
