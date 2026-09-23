import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardSummaryDto } from '@inkflow/shared';
import { __resetClientStateForTests } from '@/lib/api/client';
import { installFetchMock, type MockRoute } from '@/test/fetch-mock';
import { NOW, makeBoard, makeUser, makeWorkspace } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { DashboardLayout } from './DashboardLayout';
import { HomeView } from './views/HomeView';
import { TrashView } from './views/TrashView';
import { useDashboardUi } from './ui-store';

const me = makeUser();
const roadmap = makeBoard({ id: 'b1', title: 'Roadmap', updatedAt: '2026-09-20T09:00:00.000Z' });
const retro = makeBoard({
  id: 'b2',
  title: 'Sprint retro',
  isFavorite: true,
  updatedAt: '2026-09-19T09:00:00.000Z',
});
const shared = makeBoard({
  id: 'b3',
  title: 'Client flow',
  role: 'VIEWER',
  updatedAt: '2026-09-18T09:00:00.000Z',
});
const trashed = makeBoard({ id: 'b9', title: 'Old sketch', deletedAt: NOW });

function baseRoutes(boards: BoardSummaryDto[], extra: MockRoute[] = []): MockRoute[] {
  return [
    ...extra,
    { method: 'GET', path: '/auth/me', respond: { body: { user: me } } },
    { method: 'GET', path: '/workspaces', respond: { body: [makeWorkspace()] } },
    { method: 'GET', path: '/workspaces/w1/projects', respond: { body: [] } },
    { method: 'GET', path: '/workspaces/w1/folders', respond: { body: [] } },
    { method: 'GET', path: '/templates', respond: { body: [] } },
    { method: 'GET', path: '/notifications', respond: { body: { items: [], unreadCount: 0 } } },
    {
      method: 'GET',
      path: '/boards',
      respond: (call) => ({ body: call.query.get('filter') === 'trash' ? [trashed] : boards }),
    },
  ];
}

function renderDashboard(route = '/w/w1') {
  return renderWithProviders(<DashboardLayout />, {
    route,
    path: '/w/:workspaceId',
    children: [
      { index: true, element: <HomeView /> },
      { path: 'trash', element: <TrashView /> },
    ],
    routes: [{ path: '/b/:boardId', element: <div data-testid="editor-route" /> }],
  });
}

const card = (id: string) =>
  screen.getAllByTestId('board-card').find((el) => el.dataset.boardId === id)!;
/** Waits for the board list (toasts from other tests may contain the same titles). */
const findCard = (id: string) =>
  waitFor(() => {
    const el = screen.getAllByTestId('board-card').find((c) => c.dataset.boardId === id);
    if (!el) throw new Error(`board ${id} not rendered`);
    return el;
  });

async function openCardMenu(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(within(card(id)).getByTestId('board-card-menu'));
  return screen.findByRole('menu');
}

beforeEach(() => {
  __resetClientStateForTests();
  document.cookie = 'inkflow_csrf=csrf; path=/';
  useDashboardUi.setState({
    renameBoard: null,
    moveBoard: null,
    shareBoard: null,
    searchOpen: false,
    newBoard: { open: false, defaults: {} },
  });
});

describe('dashboard board list', () => {
  it('renders workspace boards (most recent first) with owner, role and favorite state', async () => {
    const mock = installFetchMock(baseRoutes([shared, retro, roadmap]));
    renderDashboard();
    await findCard('b1');
    const cards = screen.getAllByTestId('board-card');
    expect(cards.map((c) => c.dataset.boardId)).toEqual(['b1', 'b2', 'b3']);
    expect(within(card('b3')).getByTestId('board-role')).toHaveTextContent('Can view');
    expect(within(card('b2')).getByTestId('board-favorite')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('workspace-switcher')).toHaveTextContent('Acme');

    const list = mock.callsTo('GET', '/boards')[0]!;
    expect(list.query.get('workspaceId')).toBe('w1');
    expect(list.query.get('filter')).toBe('all');
  });

  it('toggles favorites with PUT/DELETE /boards/:id/favorite', async () => {
    const mock = installFetchMock(
      baseRoutes(
        [roadmap, retro],
        [
          { method: 'PUT', path: '/boards/b1/favorite', respond: { body: { ok: true } } },
          { method: 'DELETE', path: '/boards/b2/favorite', respond: { body: { ok: true } } },
        ],
      ),
    );
    const user = userEvent.setup();
    renderDashboard();
    await findCard('b1');
    await user.click(within(card('b1')).getByTestId('board-favorite'));
    await waitFor(() =>
      expect(within(card('b1')).getByTestId('board-favorite')).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    await user.click(within(card('b2')).getByTestId('board-favorite'));
    await waitFor(() => expect(mock.callsTo('DELETE', '/boards/b2/favorite')).toHaveLength(1));
    expect(mock.callsTo('PUT', '/boards/b1/favorite')).toHaveLength(1);
  });

  it('renames a board from its menu (PATCH /boards/:id)', async () => {
    const mock = installFetchMock(
      baseRoutes(
        [roadmap],
        [
          {
            method: 'PATCH',
            path: '/boards/b1',
            respond: (call) => ({
              body: { ...roadmap, title: (call.body as { title: string }).title },
            }),
          },
        ],
      ),
    );
    const user = userEvent.setup();
    renderDashboard();
    await findCard('b1');
    await openCardMenu(user, 'b1');
    await user.click(screen.getByTestId('board-menu-rename'));
    const input = await screen.findByTestId('rename-input');
    await user.clear(input);
    await user.type(input, 'Product roadmap');
    await user.click(screen.getByTestId('rename-submit'));

    await waitFor(() =>
      expect(within(card('b1')).getByText('Product roadmap')).toBeInTheDocument(),
    );
    expect(mock.callsTo('PATCH', '/boards/b1')[0]!.body).toEqual({ title: 'Product roadmap' });
    await waitFor(() => expect(screen.queryByTestId('rename-input')).not.toBeInTheDocument());
  });

  it('moves a board to the trash (DELETE /boards/:id) and duplicates boards', async () => {
    const copy = makeBoard({ id: 'b5', title: 'Roadmap (copy)' });
    const mock = installFetchMock(
      baseRoutes(
        [roadmap, retro],
        [
          { method: 'DELETE', path: '/boards/b1', respond: { body: { ok: true } } },
          { method: 'POST', path: '/boards/b2/duplicate', respond: { body: copy } },
        ],
      ),
    );
    const user = userEvent.setup();
    renderDashboard();
    await findCard('b1');

    await openCardMenu(user, 'b2');
    await user.click(screen.getByTestId('board-menu-duplicate'));
    await waitFor(() => expect(mock.callsTo('POST', '/boards/b2/duplicate')).toHaveLength(1));

    await openCardMenu(user, 'b1');
    await user.click(screen.getByTestId('board-menu-delete'));
    await waitFor(() => expect(mock.callsTo('DELETE', '/boards/b1')).toHaveLength(1));
    expect(await screen.findByText('Moved to trash')).toBeInTheDocument();
  });

  it('disables owner-only actions for viewers', async () => {
    installFetchMock(baseRoutes([shared]));
    const user = userEvent.setup();
    renderDashboard();
    await findCard('b3');
    await openCardMenu(user, 'b3');
    expect(screen.getByTestId('board-menu-delete')).toHaveAttribute('data-disabled');
    expect(screen.getByTestId('board-menu-rename')).toHaveAttribute('data-disabled');
    expect(screen.getByTestId('board-menu-share')).toHaveAttribute('data-disabled');
  });

  it('opens the share dialog from the board menu', async () => {
    const mock = installFetchMock(
      baseRoutes(
        [roadmap],
        [
          {
            method: 'GET',
            path: '/boards/b1/sharing',
            respond: { body: { members: [], pending: [], workspaceAccess: 'NONE', links: [] } },
          },
        ],
      ),
    );
    const user = userEvent.setup();
    renderDashboard();
    await findCard('b1');
    await openCardMenu(user, 'b1');
    await user.click(screen.getByTestId('board-menu-share'));
    expect(await screen.findByRole('dialog', { name: 'Share “Roadmap”' })).toBeInTheDocument();
    await waitFor(() => expect(mock.callsTo('GET', '/boards/b1/sharing')).toHaveLength(1));
  });

  it('creates a board from the "New board" dialog and opens it', async () => {
    const created = makeBoard({ id: 'b42', title: 'Architecture' });
    const mock = installFetchMock(
      baseRoutes(
        [],
        [{ method: 'POST', path: '/boards', respond: { status: 201, body: created } }],
      ),
    );
    const user = userEvent.setup();
    renderDashboard();
    expect(await screen.findByText('No boards yet')).toBeInTheDocument();
    await user.click(screen.getByTestId('new-board'));
    await user.type(await screen.findByTestId('new-board-title'), 'Architecture');
    await user.click(screen.getByTestId('new-board-submit'));

    expect(await screen.findByTestId('editor-route')).toBeInTheDocument();
    expect(mock.callsTo('POST', '/boards')[0]!.body).toEqual({
      workspaceId: 'w1',
      title: 'Architecture',
      projectId: null,
      folderId: null,
    });
  });
});

describe('trash view', () => {
  it('restores and permanently deletes boards', async () => {
    const mock = installFetchMock(
      baseRoutes(
        [],
        [
          {
            method: 'POST',
            path: '/boards/b9/restore',
            respond: { body: { ...trashed, deletedAt: null } },
          },
          { method: 'DELETE', path: '/boards/b9/permanent', respond: { body: { ok: true } } },
        ],
      ),
    );
    const user = userEvent.setup();
    renderDashboard('/w/w1/trash');
    expect(await findCard('b9')).toHaveTextContent('Old sketch');
    expect(mock.callsTo('GET', '/boards').some((c) => c.query.get('filter') === 'trash')).toBe(
      true,
    );

    await user.click(screen.getByTestId('trash-delete-forever'));
    await user.click(await screen.findByTestId('trash-delete-confirm'));
    await waitFor(() => expect(mock.callsTo('DELETE', '/boards/b9/permanent')).toHaveLength(1));

    // The list refetches (still returns the board in this mock) — restore it.
    await user.click(await screen.findByTestId('trash-restore'));
    await waitFor(() => expect(mock.callsTo('POST', '/boards/b9/restore')).toHaveLength(1));
  });

  it('empties the trash after confirmation', async () => {
    const mock = installFetchMock(
      baseRoutes(
        [],
        [{ method: 'POST', path: '/boards/trash/empty', respond: { body: { deleted: 1 } } }],
      ),
    );
    const user = userEvent.setup();
    renderDashboard('/w/w1/trash');
    await findCard('b9');
    await user.click(screen.getByTestId('trash-empty'));
    await user.click(await screen.findByTestId('trash-empty-confirm'));
    await waitFor(() => expect(mock.callsTo('POST', '/boards/trash/empty')).toHaveLength(1));
    expect(mock.callsTo('POST', '/boards/trash/empty')[0]!.body).toEqual({ workspaceId: 'w1' });
  });
});
