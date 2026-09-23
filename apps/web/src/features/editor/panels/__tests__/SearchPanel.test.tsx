import { createElement } from '@inkflow/elements';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetClientStateForTests } from '@/lib/api/client';
import { installFetchMock } from '@/test/fetch-mock';
import { SearchPanel } from '../SearchPanel';
import { createTestEditor, renderInSession } from './test-session';

function text(id: string, value: string, x: number, y: number) {
  return createElement('text', { id, text: value, x, y, width: 120, height: 24 });
}

beforeEach(() => {
  __resetClientStateForTests();
  installFetchMock([
    {
      method: 'GET',
      path: '/auth/me',
      respond: { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'no' } } },
    },
  ]);
});

describe('SearchPanel', () => {
  it('steps through matches with Enter / Shift+Enter and the arrow buttons', async () => {
    const editor = createTestEditor([
      text('t1', 'Payment service', 0, 0),
      text('t2', 'Unrelated', 0, 100),
      text('t3', 'Payment gateway', 0, 200),
    ]);
    const focus = vi.spyOn(editor, 'focusElement');
    const user = userEvent.setup();
    const { unmount } = renderInSession(<SearchPanel />, editor);

    const input = screen.getByTestId('search-canvas-input');
    await user.type(input, 'payment');
    expect(screen.getByTestId('search-status')).toHaveTextContent('2 results');
    expect(editor.state.searchHighlightIds).toEqual(['t1', 't3']);
    expect(screen.getAllByTestId('search-result')).toHaveLength(2);

    await user.keyboard('{Enter}');
    expect(focus).toHaveBeenLastCalledWith('t1');
    expect(screen.getByTestId('search-status')).toHaveTextContent('1 of 2');
    expect(editor.state.selectedIds).toEqual(['t1']);

    await user.keyboard('{Enter}');
    expect(focus).toHaveBeenLastCalledWith('t3');
    expect(screen.getByTestId('search-status')).toHaveTextContent('2 of 2');

    // Wraps around.
    await user.keyboard('{Enter}');
    expect(focus).toHaveBeenLastCalledWith('t1');

    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(focus).toHaveBeenLastCalledWith('t3');
    expect(screen.getByTestId('search-status')).toHaveTextContent('2 of 2');

    await user.click(screen.getByTestId('search-prev'));
    expect(focus).toHaveBeenLastCalledWith('t1');
    await user.click(screen.getByTestId('search-next'));
    expect(focus).toHaveBeenLastCalledWith('t3');
    // Every match stays highlighted while navigating.
    expect(editor.state.searchHighlightIds).toEqual(['t1', 't3']);

    unmount();
    expect(editor.state.searchHighlightIds).toEqual([]);
  });

  it('shows an empty state when nothing matches', async () => {
    const editor = createTestEditor([text('t1', 'Hello', 0, 0)]);
    const user = userEvent.setup();
    renderInSession(<SearchPanel />, editor);
    await user.type(screen.getByTestId('search-canvas-input'), 'zzz');
    expect(screen.getByTestId('search-status')).toHaveTextContent('No results');
    expect(screen.getByTestId('search-next')).toBeDisabled();
    expect(editor.state.searchHighlightIds).toEqual([]);
  });
});
