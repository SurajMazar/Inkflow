import { createElement } from '@inkflow/elements';
import { createEvent, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetClientStateForTests } from '@/lib/api/client';
import { installFetchMock } from '@/test/fetch-mock';
import { FramesPanel } from '../FramesPanel';
import { createTestEditor, renderInSession } from './test-session';

const frame = (id: string, name: string, x: number) => createElement('frame', { id, name, x, y: 0, width: 200, height: 150 });

const rowNames = () => screen.getAllByTestId('frame-row').map((r) => r.getAttribute('data-frame-id'));

beforeEach(() => {
  __resetClientStateForTests();
  installFetchMock([{ method: 'GET', path: '/auth/me', respond: { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'no' } } } }]);
});

describe('FramesPanel', () => {
  it('reorders frames with the up/down buttons and persists the presentation order', async () => {
    const editor = createTestEditor([frame('f1', 'Intro', 0), frame('f2', 'Problem', 300), frame('f3', 'Solution', 600)]);
    const user = userEvent.setup();
    renderInSession(<FramesPanel />, editor);

    expect(rowNames()).toEqual(['f1', 'f2', 'f3']);
    const first = screen.getAllByTestId('frame-row')[0]!;
    expect(within(first).getByTestId('frame-move-up')).toBeDisabled();

    await user.click(within(first).getByTestId('frame-move-down'));
    expect(editor.appState.frameOrder).toEqual(['f2', 'f1', 'f3']);
    expect(rowNames()).toEqual(['f2', 'f1', 'f3']);

    const last = screen.getAllByTestId('frame-row')[2]!;
    await user.click(within(last).getByTestId('frame-move-up'));
    expect(editor.getOrderedFrames().map((f) => f.id)).toEqual(['f2', 'f3', 'f1']);
    expect(rowNames()).toEqual(['f2', 'f3', 'f1']);
  });

  it('reorders frames by dragging a row onto another', () => {
    const editor = createTestEditor([frame('f1', 'A', 0), frame('f2', 'B', 300), frame('f3', 'C', 600)]);
    renderInSession(<FramesPanel />, editor);
    const [r1, , r3] = screen.getAllByTestId('frame-row');
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => store.set(k, v),
      getData: (k: string) => store.get(k) ?? '',
      get types() {
        return [...store.keys()];
      },
      effectAllowed: 'all',
      dropEffect: 'none',
    };
    fireEvent.dragStart(r1!, { dataTransfer });
    // Drop on the lower half of the last row → after it.
    r3!.getBoundingClientRect = () => ({ top: 0, height: 40, bottom: 40, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    // jsdom has no DragEvent, so pointer coordinates are attached to the events by hand.
    const at = (ev: Event) => Object.defineProperty(ev, 'clientY', { value: 30 });
    fireEvent(r3!, at(createEvent.dragOver(r3!, { dataTransfer })));
    fireEvent(r3!, at(createEvent.drop(r3!, { dataTransfer })));
    expect(editor.getOrderedFrames().map((f) => f.id)).toEqual(['f2', 'f3', 'f1']);
  });

  it('renames a frame inline', async () => {
    const editor = createTestEditor([frame('f1', 'Intro', 0)]);
    const user = userEvent.setup();
    renderInSession(<FramesPanel />, editor);
    await user.dblClick(screen.getByRole('button', { name: 'Intro' }));
    const input = screen.getByTestId('frame-name-input');
    await user.clear(input);
    await user.type(input, 'Welcome{Enter}');
    const f = editor.getElement('f1');
    expect(f?.type === 'frame' && f.name).toBe('Welcome');
  });

  it('is read-only for viewers', () => {
    const editor = createTestEditor([frame('f1', 'Intro', 0), frame('f2', 'Next', 300)], { readOnly: true });
    renderInSession(<FramesPanel />, editor, { role: 'VIEWER' });
    expect(screen.queryByTestId('frame-move-down')).not.toBeInTheDocument();
    expect(screen.getByTestId('frames-present')).toBeEnabled();
  });
});
