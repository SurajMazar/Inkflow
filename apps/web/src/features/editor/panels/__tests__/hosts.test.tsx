import { LIBRARY_ITEMS } from '@inkflow/diagram-engine';
import { createElement } from '@inkflow/elements';
import type { CommentDto } from '@inkflow/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetClientStateForTests } from '@/lib/api/client';
import { installFetchMock } from '@/test/fetch-mock';
import { NOW, makeUser, publicUser } from '@/test/fixtures';
import { CommentPins } from '../../components/CommentPins';
import { DialogHost } from '../../dialogs';
import { useEditorUi, type EditorPanel } from '../../hooks/ui-store';
import { PresentationOverlay } from '../../presentation/PresentationOverlay';
import { PanelHost } from '../index';
import { LIBRARY_DRAG_MIME, handleLibraryDrop } from '../library-drop';
import { createTestEditor, renderInSession } from './test-session';

const me = makeUser();

function comment(overrides: Partial<CommentDto> = {}): CommentDto {
  return {
    id: 'c1',
    boardId: 'b1',
    author: publicUser(me),
    body: 'Check this',
    anchor: { type: 'element', elementId: 'r1', x: 10, y: 5 },
    mentions: [],
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  __resetClientStateForTests();
  document.cookie = 'inkflow_csrf=csrf; path=/';
  installFetchMock([
    { method: 'GET', path: '/auth/me', respond: { body: { user: me } } },
    { method: 'GET', path: '/boards/b1/comments', respond: { body: [comment()] } },
    { method: 'GET', path: '/boards/b1/versions', respond: { body: [] } },
  ]);
});

describe('PanelHost', () => {
  it.each<[EditorPanel, string]>([
    ['comments', 'panel-comments'],
    ['versions', 'panel-versions'],
    ['search', 'panel-search'],
    ['library', 'panel-library'],
    ['layers', 'panel-layers'],
    ['frames', 'panel-frames'],
    ['structure', 'structured-editor'],
  ])('renders the %s panel and closes it', async (panel, testId) => {
    const user = userEvent.setup();
    renderInSession(<PanelHost compact={false} />, createTestEditor());
    act(() => useEditorUi.getState().setPanel(panel));
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    expect(screen.getByTestId('side-panel')).toHaveAttribute('data-inkflow-ui');
    await user.click(screen.getByTestId('panel-close'));
    expect(useEditorUi.getState().panel).toBeNull();
  });

  it('uses a bottom sheet on compact screens', async () => {
    renderInSession(<PanelHost compact />, createTestEditor());
    act(() => useEditorUi.getState().setPanel('layers'));
    expect(await screen.findByTestId('panel-layers')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('LayersPanel', () => {
  it('selects, hides/shows and locks/unlocks elements', async () => {
    const editor = createTestEditor([
      createElement('rectangle', { id: 'a', x: 0, y: 0, width: 10, height: 10 }),
      createElement('text', { id: 'b', x: 0, y: 0, width: 10, height: 10, text: 'Top label' }),
    ]);
    const user = userEvent.setup();
    renderInSession(<PanelHost compact={false} />, editor);
    act(() => useEditorUi.getState().setPanel('layers'));
    const rows = await screen.findAllByTestId('layer-row');
    expect(rows.map((r) => r.getAttribute('data-element-id'))).toEqual(['b', 'a']);

    await user.click(within(rows[1]!).getByRole('button', { name: 'Rectangle: Rectangle' }));
    expect(editor.state.selectedIds).toEqual(['a']);
    await user.keyboard('{Shift>}');
    await user.click(within(rows[0]!).getByRole('button', { name: 'Text: Top label' }));
    await user.keyboard('{/Shift}');
    expect([...editor.state.selectedIds].sort()).toEqual(['a', 'b']);

    await user.click(within(rows[1]!).getByTestId('layer-visibility'));
    expect(editor.getElement('a')!.hidden).toBe(true);
    await user.click(
      within(screen.getAllByTestId('layer-row')[1]!).getByTestId('layer-visibility'),
    );
    expect(editor.getElement('a')!.hidden).toBe(false);

    await user.click(within(screen.getAllByTestId('layer-row')[1]!).getByTestId('layer-lock'));
    expect(editor.getElement('a')!.locked).toBe(true);
    await user.click(within(screen.getAllByTestId('layer-row')[1]!).getByTestId('layer-lock'));
    expect(editor.getElement('a')!.locked).toBe(false);
  });
});

describe('LibraryPanel', () => {
  it('inserts a library item at the viewport center and supports canvas drops', async () => {
    const editor = createTestEditor();
    const user = userEvent.setup();
    renderInSession(<PanelHost compact={false} />, editor);
    act(() => useEditorUi.getState().setPanel('library'));
    const items = await screen.findAllByTestId('library-item');
    await user.click(items[0]!);
    expect(editor.getElements().length).toBeGreaterThan(0);

    const before = editor.getElements().length;
    const item = LIBRARY_ITEMS.find((i) => i.id === 'database')!;
    const data = {
      types: [LIBRARY_DRAG_MIME],
      getData: (k: string) => (k === LIBRARY_DRAG_MIME ? item.id : ''),
    } as unknown as DataTransfer;
    expect(handleLibraryDrop(editor, data, { x: 300, y: 200 })).toBe(true);
    expect(editor.getElements().length).toBe(before + item.create({ x: 0, y: 0 }).length);
    const files = { types: ['Files'], getData: () => '' } as unknown as DataTransfer;
    expect(handleLibraryDrop(editor, files, { x: 0, y: 0 })).toBe(false);
  });

  it('inserts Mermaid diagrams and templates', async () => {
    const editor = createTestEditor();
    const user = userEvent.setup();
    renderInSession(<PanelHost compact={false} />, editor);
    act(() => useEditorUi.getState().setPanel('library'));
    await user.click(await screen.findByRole('tab', { name: 'From text' }));
    await user.type(screen.getByTestId('mermaid-input'), 'flowchart LR{Enter}  A --> B');
    await user.click(screen.getByTestId('mermaid-insert'));
    expect(editor.getElements().some((e) => e.type === 'connector')).toBe(true);

    await user.click(screen.getByRole('tab', { name: 'Templates' }));
    const inserts = await screen.findAllByTestId('template-insert');
    const count = editor.getElements().length;
    await user.click(inserts[0]!);
    expect(editor.getElements().length).toBeGreaterThan(count);
  });
});

describe('CommentPins', () => {
  it('positions element-anchored pins with the viewport and opens the thread', async () => {
    const editor = createTestEditor([
      createElement('rectangle', { id: 'r1', x: 100, y: 50, width: 80, height: 40 }),
    ]);
    editor.setViewport({ x: 50, y: 0, zoom: 2, width: 1000, height: 800 });
    const user = userEvent.setup();
    renderInSession(<CommentPins />, editor);
    const pin = await screen.findByTestId('comment-pin');
    // screen = (world - viewport) * zoom; world = element + anchor = (110, 55).
    expect(pin.style.transform).toBe('translate(120px, 78px)');
    await user.click(pin);
    expect(useEditorUi.getState()).toMatchObject({ panel: 'comments', activeCommentId: 'c1' });

    act(() => editor.deleteElements(['r1']));
    await waitFor(() => expect(screen.queryByTestId('comment-pin')).not.toBeInTheDocument());
  });
});

describe('PresentationOverlay', () => {
  it('navigates between frames and exits', async () => {
    const editor = createTestEditor([
      createElement('frame', { id: 'f1', name: 'One', x: 0, y: 0, width: 400, height: 300 }),
      createElement('frame', { id: 'f2', name: 'Two', x: 500, y: 0, width: 400, height: 300 }),
    ]);
    editor.startPresentation();
    const stop = vi.spyOn(editor, 'stopPresentation');
    const user = userEvent.setup();
    renderInSession(<PresentationOverlay />, editor);
    expect(screen.getByTestId('presentation-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('presentation-position')).toHaveTextContent('1 / 2');
    expect(screen.getByTestId('presentation-prev')).toBeDisabled();

    await user.click(screen.getByTestId('presentation-next'));
    expect(editor.state.presentation.frameIndex).toBe(1);
    expect(screen.getByTestId('presentation-position')).toHaveTextContent('2 / 2');
    expect(screen.getByTestId('presentation-position')).toHaveTextContent('Two');

    await user.click(screen.getByTestId('presentation-prev'));
    expect(editor.state.presentation.frameIndex).toBe(0);

    await user.click(screen.getByTestId('presentation-laser'));
    expect(editor.state.tool).toBe('laser');

    await user.click(screen.getByTestId('presentation-exit'));
    expect(stop).toHaveBeenCalled();
    expect(editor.state.presentation.active).toBe(false);
  });
});

describe('DialogHost', () => {
  it('opens the shortcuts dialog and filters it', async () => {
    const user = userEvent.setup();
    renderInSession(<DialogHost />, createTestEditor());
    act(() => useEditorUi.getState().openDialog('shortcuts'));
    const dialog = await screen.findByTestId('shortcuts-dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Search shortcuts' }), 'undo');
    expect(within(dialog).getByText('Undo')).toBeInTheDocument();
    expect(within(dialog).queryByText('Rectangle')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(useEditorUi.getState().dialog).toBeNull();
  });

  it('runs actions from the command palette', async () => {
    const editor = createTestEditor([
      createElement('rectangle', { id: 'a', x: 0, y: 0, width: 10, height: 10 }),
    ]);
    const user = userEvent.setup();
    renderInSession(<DialogHost />, editor);
    act(() => useEditorUi.getState().openDialog('command'));
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument();
    await user.keyboard('select all');
    await user.click(await screen.findByTestId('command-edit.selectAll'));
    await waitFor(() => expect(editor.state.selectedIds).toEqual(['a']));
    expect(useEditorUi.getState().dialog).toBeNull();
  });

  it('applies auto layout to the selection', async () => {
    const editor = createTestEditor([
      createElement('rectangle', { id: 'a', x: 0, y: 0, width: 50, height: 50 }),
      createElement('rectangle', { id: 'b', x: 10, y: 10, width: 50, height: 50 }),
    ]);
    editor.select(['a', 'b']);
    const run = vi.spyOn(editor.actions, 'run');
    const user = userEvent.setup();
    renderInSession(<DialogHost />, editor);
    act(() => useEditorUi.getState().openDialog('autolayout'));
    await screen.findByTestId('autolayout-dialog');
    await user.click(screen.getByTestId('autolayout-grid'));
    await user.click(screen.getByTestId('autolayout-apply'));
    expect(run).toHaveBeenCalledWith('diagram.autoLayout', { kind: 'grid' });
    expect(useEditorUi.getState().dialog).toBeNull();
  });

  it('validates links before saving them', async () => {
    const editor = createTestEditor([
      createElement('rectangle', { id: 'a', x: 0, y: 0, width: 50, height: 50 }),
    ]);
    const user = userEvent.setup();
    renderInSession(<DialogHost />, editor);
    act(() => useEditorUi.getState().openLink('a'));
    const input = await screen.findByTestId('link-input');
    await user.type(input, 'javascript:alert(1)');
    await user.click(screen.getByTestId('link-save'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(editor.getElement('a')!.link).toBeNull();

    await user.clear(input);
    await user.type(input, 'example.com/spec');
    await user.click(screen.getByTestId('link-save'));
    expect(editor.getElement('a')!.link).toBe('https://example.com/spec');
  });
});
