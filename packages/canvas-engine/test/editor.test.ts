import { createElement, type SceneElement } from '@inkflow/elements';
import { indicesAbove } from '@inkflow/scene';
import { describe, expect, it } from 'vitest';
import { Editor, parseClipboardPayload, type CanvasPointerEvent } from '../src';

function makeEditor() {
  const editor = new Editor();
  editor.setViewport({ x: 0, y: 0, zoom: 1, width: 1000, height: 800 });
  return editor;
}

function rect(id: string, x: number, y: number, extra: Partial<SceneElement> = {}) {
  return createElement('rectangle', { id, x, y, width: 100, height: 60, backgroundColor: '#ffffff', ...(extra as object) });
}

function load(editor: Editor, elements: SceneElement[]) {
  const keys = indicesAbove([], elements.length);
  editor.loadDocument({
    version: 2,
    elements: elements.map((e, i) => ({ ...e, index: keys[i]! })),
    appState: { viewBackgroundColor: '#fff', gridType: 'dot', gridSize: 20, frameOrder: [] },
    files: {},
  });
}

function pointer(x: number, y: number, extra: Partial<CanvasPointerEvent> = {}): CanvasPointerEvent {
  return {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    screen: { x, y },
    world: { x, y },
    pressure: 0.5,
    hasPressure: false,
    timeStamp: performance.now(),
    isPrimary: true,
    shift: false,
    alt: false,
    mod: false,
    ctrl: false,
    meta: false,
    ...extra,
  };
}

function drag(editor: Editor, from: [number, number], to: [number, number], extra: Partial<CanvasPointerEvent> = {}) {
  const tool = editor.activeTool;
  tool.onPointerDown(pointer(from[0], from[1], extra));
  for (let i = 1; i <= 5; i++) {
    const x = from[0] + ((to[0] - from[0]) * i) / 5;
    const y = from[1] + ((to[1] - from[1]) * i) / 5;
    tool.onPointerMove(pointer(x, y, extra));
  }
  tool.onPointerUp(pointer(to[0], to[1], { ...extra, buttons: 0 }));
}

describe('Editor', () => {
  it('draws a rectangle with the rectangle tool as a single undoable step', () => {
    const editor = makeEditor();
    const commits: number[] = [];
    editor.events.on('commit', (tx) => commits.push(tx.changes.length));
    editor.setTool('rectangle');
    drag(editor, [100, 100], [300, 250]);
    const els = editor.getElements();
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: 'rectangle', x: 100, y: 100, width: 200, height: 150 });
    expect(editor.state.selectedIds).toEqual([els[0]!.id]);
    expect(editor.state.tool).toBe('selection');
    expect(commits).toEqual([1]);
    editor.undo();
    expect(editor.getElements()).toHaveLength(0);
    editor.redo();
    expect(editor.getElements()).toHaveLength(1);
  });

  it('moves selected elements by dragging (one history entry)', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0)]);
    editor.setState({ snapping: { toGrid: false, toObjects: false, angle: true } });
    drag(editor, [50, 30], [150, 130]);
    expect(editor.getElement('a')).toMatchObject({ x: 100, y: 100 });
    expect(editor.history.undoDepth).toBe(1);
    editor.undo();
    expect(editor.getElement('a')).toMatchObject({ x: 0, y: 0 });
  });

  it('selects with a marquee and groups/ungroups', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 100, 100), rect('b', 300, 100), rect('c', 800, 600)]);
    drag(editor, [50, 50], [450, 200]);
    expect([...editor.state.selectedIds].sort()).toEqual(['a', 'b']);
    editor.actions.run('arrange.group');
    const g = editor.getElement('a')!.groupIds[0];
    expect(g).toBeTruthy();
    expect(editor.getElement('b')!.groupIds).toEqual([g]);
    editor.clearSelection();
    // Clicking one member selects the whole group.
    editor.activeTool.onPointerDown(pointer(150, 130));
    editor.activeTool.onPointerUp(pointer(150, 130, { buttons: 0 }));
    expect([...editor.state.selectedIds].sort()).toEqual(['a', 'b']);
    editor.actions.run('arrange.ungroup');
    expect(editor.getElement('a')!.groupIds).toEqual([]);
  });

  it('resizes with handles', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0)]);
    editor.select(['a']);
    // se handle sits at (100 + pad, 60 + pad) with 4px padding
    drag(editor, [104, 64], [204, 124]);
    const a = editor.getElement('a')!;
    expect(a.width).toBeCloseTo(200, 0);
    expect(a.height).toBeCloseTo(120, 0);
  });

  it('deletes, duplicates, reorders and aligns via actions', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0), rect('b', 200, 50)]);
    editor.select(['a', 'b']);
    editor.actions.run('arrange.alignTop');
    expect(editor.getElement('b')!.y).toBe(0);
    editor.select(['a']);
    editor.actions.run('arrange.bringToFront');
    expect(editor.getElements().at(-1)!.id).toBe('a');
    editor.actions.run('edit.duplicate');
    expect(editor.getElements()).toHaveLength(3);
    editor.actions.run('edit.delete');
    expect(editor.getElements()).toHaveLength(2);
  });

  it('locks and hides elements', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0)]);
    editor.select(['a']);
    editor.actions.run('arrange.lock');
    expect(editor.getElement('a')!.locked).toBe(true);
    expect(editor.state.selectedIds).toEqual([]);
    editor.actions.run('arrange.unlockAll');
    expect(editor.getElement('a')!.locked).toBe(false);
    editor.select(['a']);
    editor.actions.run('arrange.hide');
    expect(editor.getElement('a')!.hidden).toBe(true);
    editor.actions.run('arrange.showAll');
    expect(editor.getElement('a')!.hidden).toBe(false);
  });

  it('edits text through the overlay API and removes empty new text', () => {
    const editor = makeEditor();
    editor.createTextAt({ x: 10, y: 10 });
    const id = editor.state.textEdit!.elementId;
    editor.updateTextEdit('Hello\nWorld');
    editor.commitTextEdit();
    const el = editor.getElement(id)!;
    expect(el.type === 'text' && el.text).toBe('Hello\nWorld');
    expect(el.height).toBeGreaterThan(20);
    editor.createTextAt({ x: 300, y: 10 });
    editor.commitTextEdit();
    expect(editor.getElements()).toHaveLength(1);
    // One history entry for create+type.
    editor.undo();
    expect(editor.getElements()).toHaveLength(0);
  });

  it('edits shape labels', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0)]);
    editor.startTextEdit('a', 'label');
    editor.updateTextEdit('Service');
    editor.commitTextEdit();
    const a = editor.getElement('a')!;
    expect(a.type === 'rectangle' && a.label?.text).toBe('Service');
  });

  it('creates bound arrows and keeps them attached when shapes move', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0), rect('b', 400, 0)]);
    editor.setTool('arrow');
    drag(editor, [50, 30], [450, 30]);
    const arrow = editor.getElements().find((e) => e.type === 'arrow')!;
    expect(arrow.type === 'arrow' && arrow.startBinding?.elementId).toBe('a');
    expect(arrow.type === 'arrow' && arrow.endBinding?.elementId).toBe('b');
    editor.updateElements([['b', { x: 400, y: 300 }]], 'Move');
    const moved = editor.getElement(arrow.id)!;
    expect(moved.y + moved.height).toBeGreaterThan(250);
  });

  it('draws freehand strokes with the pencil and stays in the tool', () => {
    const editor = makeEditor();
    editor.setTool('pencil');
    drag(editor, [0, 0], [100, 80]);
    const stroke = editor.getElements()[0]!;
    expect(stroke.type).toBe('freedraw');
    expect(editor.state.tool).toBe('pencil');
  });

  it('erases touched elements', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0), rect('b', 400, 0)]);
    editor.setTool('eraser');
    drag(editor, [50, 30], [60, 40]);
    expect(editor.getElements().map((e) => e.id)).toEqual(['b']);
  });

  it('copies and pastes elements with fresh ids', async () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0)]);
    editor.select(['a']);
    const payload = editor.clipboard.buildPayload()!;
    const parsed = parseClipboardPayload(JSON.stringify(payload))!;
    await editor.clipboard.pasteData({ text: JSON.stringify(parsed) });
    const els = editor.getElements();
    expect(els).toHaveLength(2);
    expect(new Set(els.map((e) => e.id)).size).toBe(2);
  });

  it('pastes plain text as a text element', async () => {
    const editor = makeEditor();
    await editor.clipboard.pasteData({ text: 'https://example.com' });
    const el = editor.getElements()[0]!;
    expect(el.type).toBe('text');
    expect(el.link).toBe('https://example.com');
  });

  it('deleting a frame deletes its children', () => {
    const editor = makeEditor();
    const frame = createElement('frame', { id: 'f', x: 0, y: 0, width: 500, height: 400 });
    load(editor, [frame, rect('a', 10, 10, { frameId: 'f' })]);
    editor.deleteElements(['f']);
    expect(editor.getElements()).toHaveLength(0);
  });

  it('presents frames in order', () => {
    const editor = makeEditor();
    load(editor, [
      createElement('frame', { id: 'f1', x: 0, y: 0, width: 400, height: 300, name: 'One' }),
      createElement('frame', { id: 'f2', x: 600, y: 0, width: 400, height: 300, name: 'Two' }),
    ]);
    expect(editor.startPresentation()).toBe(true);
    expect(editor.state.presentation.frameIds).toEqual(['f1', 'f2']);
    editor.nextFrame();
    expect(editor.state.presentation.frameIndex).toBe(1);
    editor.stopPresentation();
    expect(editor.state.presentation.active).toBe(false);
  });

  it('respects read-only mode', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0)]);
    editor.setState({ readOnly: true });
    editor.select(['a']);
    expect(editor.actions.run('edit.delete')).toBe(false);
    editor.setTool('rectangle');
    expect(editor.state.tool).toBe('selection');
    expect(editor.getElements()).toHaveLength(1);
  });

  it('applies remote changes without history and keeps selection valid', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0)]);
    editor.select(['a']);
    const a = editor.getElement('a')!;
    editor.applyRemoteElements([{ ...a, isDeleted: true, version: a.version + 1 }]);
    expect(editor.getElements()).toHaveLength(0);
    expect(editor.state.selectedIds).toEqual([]);
    expect(editor.state.canUndo).toBe(false);
  });

  it('coalesces continuous style edits into one undo step', () => {
    const editor = makeEditor();
    load(editor, [rect('a', 0, 0)]);
    editor.select(['a']);
    for (const c of ['#111111', '#222222', '#333333']) editor.applyStyle({ strokeColor: c });
    expect(editor.getElement('a')!.strokeColor).toBe('#333333');
    expect(editor.history.undoDepth).toBe(1);
    editor.undo();
    expect(editor.getElement('a')!.strokeColor).toBe('#1e1e1e');
  });

  it('handles 10,000 elements with fast spatial queries', () => {
    const editor = makeEditor();
    const els: SceneElement[] = [];
    for (let i = 0; i < 10_000; i++) els.push(rect(`r${i}`, (i % 100) * 150, Math.floor(i / 100) * 100));
    const t0 = performance.now();
    load(editor, els);
    const t1 = performance.now();
    const hits = editor.scene.queryBounds({ minX: 0, minY: 0, maxX: 1000, maxY: 800 });
    const t2 = performance.now();
    expect(hits.length).toBeGreaterThan(40);
    expect(t1 - t0).toBeLessThan(2000);
    expect(t2 - t1).toBeLessThan(50);
  });
});
