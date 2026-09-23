import { createElement } from '@inkflow/elements';
import type { CommentDto } from '@inkflow/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetClientStateForTests } from '@/lib/api/client';
import { installFetchMock, type MockRoute } from '@/test/fetch-mock';
import { NOW, makeUser, publicUser } from '@/test/fixtures';
import { useEditorUi } from '../../hooks/ui-store';
import { CommentsPanel } from '../CommentsPanel';
import { decodeMentions, encodeMentions, findMentionQuery, insertMention, parseCommentBody } from '../comments/mentions';
import { createTestEditor, renderInSession } from './test-session';

const me = makeUser();
const bob = makeUser({ id: 'u2', name: 'Bob Builder', email: 'bob@example.com' });

function comment(overrides: Partial<CommentDto> = {}): CommentDto {
  return {
    id: 'c1',
    boardId: 'b1',
    author: publicUser(bob),
    body: 'Looks good @[Ada Lovelace](u1)',
    anchor: { type: 'point', x: 0, y: 0 },
    mentions: ['u1'],
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('mention helpers', () => {
  it('finds the active @query before the caret', () => {
    expect(findMentionQuery('Hi @bo', 6)).toEqual({ start: 3, query: 'bo' });
    expect(findMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(findMentionQuery('mail@example', 12)).toBeNull();
    expect(findMentionQuery('Hi @bob there', 13)).toBeNull();
  });

  it('inserts mentions and encodes them as API tokens', () => {
    const inserted = insertMention('Hi @bo', 3, 6, { id: 'u2', name: 'Bob [Builder]' });
    expect(inserted.text).toBe('Hi @Bob Builder ');
    expect(inserted.caret).toBe(16);
    const encoded = encodeMentions(`${inserted.text}and @Bob Builders`, [inserted.mention]);
    // Only whole names become tokens.
    expect(encoded.body).toBe('Hi @[Bob Builder](u2) and @Bob Builders');
    expect(encoded.mentions).toEqual(['u2']);
  });

  it('round-trips tokens for editing and splits bodies for rendering', () => {
    const decoded = decodeMentions('Ping @[Ann Lee](a1) and @[Ann](a2)');
    expect(decoded.text).toBe('Ping @Ann Lee and @Ann');
    expect(encodeMentions(decoded.text, decoded.mentions).body).toBe('Ping @[Ann Lee](a1) and @[Ann](a2)');
    expect(parseCommentBody('x @[Ann](a2) y')).toEqual([
      { type: 'text', text: 'x ' },
      { type: 'mention', name: 'Ann', id: 'a2' },
      { type: 'text', text: ' y' },
    ]);
  });
});

describe('CommentsPanel', () => {
  let created: unknown[];

  function routes(list: CommentDto[] = [], extra: MockRoute[] = []): MockRoute[] {
    return [
      ...extra,
      { method: 'GET', path: '/auth/me', respond: { body: { user: me } } },
      { method: 'GET', path: '/boards/b1/comments', respond: { body: list } },
      { method: 'GET', path: '/users/search', respond: { body: [publicUser(bob)] } },
      {
        method: 'POST',
        path: '/boards/b1/comments',
        respond: (call) => {
          created.push(call.body);
          return { body: comment({ id: 'c-new', author: publicUser(me), body: (call.body as { body: string }).body }) };
        },
      },
    ];
  }

  beforeEach(() => {
    __resetClientStateForTests();
    document.cookie = 'inkflow_csrf=csrf; path=/';
    created = [];
  });

  it('composes a comment with an @mention anchored to an element', async () => {
    const mock = installFetchMock(routes());
    const editor = createTestEditor([createElement('rectangle', { id: 'r1', x: 100, y: 50, width: 80, height: 40 })]);
    const user = userEvent.setup();
    renderInSession(<CommentsPanel />, editor);
    act(() => useEditorUi.getState().startComment({ world: { x: 130, y: 60 }, elementId: 'r1' }));

    const input = await screen.findByTestId('comment-input');
    await user.type(input, 'Hi @bo');
    const option = await screen.findByTestId('mention-option');
    expect(option).toHaveTextContent('Bob Builder');
    await user.click(option);
    expect(input).toHaveValue('Hi @Bob Builder ');
    await user.type(input, 'can you check?');
    await user.click(screen.getByTestId('comment-submit'));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      body: 'Hi @[Bob Builder](u2) can you check?',
      mentions: ['u2'],
      anchor: { type: 'element', elementId: 'r1', x: 30, y: 10 },
    });
    expect(mock.callsTo('GET', '/users/search')[0]!.query.get('boardId')).toBe('b1');
    await waitFor(() => expect(useEditorUi.getState().activeCommentId).toBe('c-new'));
    expect(useEditorUi.getState().commentDraft).toBeNull();
  });

  it('selects a suggestion with the keyboard', async () => {
    installFetchMock(routes());
    const editor = createTestEditor();
    const user = userEvent.setup();
    renderInSession(<CommentsPanel />, editor);
    act(() => useEditorUi.getState().startComment({ world: { x: 5, y: 6 }, elementId: null }));
    const input = await screen.findByTestId('comment-input');
    await user.type(input, '@bob');
    await screen.findByTestId('mention-option');
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('@Bob Builder ');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ body: '@[Bob Builder](u2)', mentions: ['u2'], anchor: { type: 'point', x: 5, y: 6 } });
  });

  it('renders mentions as chips and filters resolved threads', async () => {
    installFetchMock(routes([comment(), comment({ id: 'c2', body: 'Old', resolvedAt: NOW, resolvedBy: publicUser(me) })]));
    const user = userEvent.setup();
    renderInSession(<CommentsPanel />, createTestEditor());
    const thread = await screen.findByTestId('comment-thread');
    expect(within(thread).getByTestId('mention-chip')).toHaveTextContent('@Ada Lovelace');
    expect(screen.getAllByTestId('comment-thread')).toHaveLength(1);
    await user.click(screen.getByTestId('comments-filter-resolved'));
    expect(screen.getAllByTestId('comment-thread')).toHaveLength(1);
    expect(screen.getByTestId('comment-thread')).toHaveTextContent('Old');
  });

  it('is read-only for anonymous visitors', async () => {
    installFetchMock([
      { method: 'GET', path: '/auth/me', respond: { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'no' } } } },
      { method: 'GET', path: '/boards/b1/comments', respond: { body: [comment()] } },
    ]);
    renderInSession(<CommentsPanel />, createTestEditor(), { canComment: false });
    await screen.findByTestId('comment-thread');
    expect(screen.getByText('Sign in to add comments and replies.')).toBeInTheDocument();
    expect(screen.queryByTestId('comment-resolve')).not.toBeInTheDocument();
    act(() => useEditorUi.getState().startComment({ world: { x: 0, y: 0 }, elementId: null }));
    expect(screen.queryByTestId('comment-input')).not.toBeInTheDocument();
  });
});
