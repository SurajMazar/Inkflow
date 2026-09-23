import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardSharingDto, ShareLinkDto } from '@inkflow/shared';
import { __resetClientStateForTests } from '@/lib/api/client';
import { installFetchMock, type MockRoute } from '@/test/fetch-mock';
import { NOW, makeBoard, makeUser, publicUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { ShareDialog } from './ShareDialog';

const me = makeUser();
const bob = makeUser({ id: 'u2', name: 'Bob Builder', email: 'bob@example.com' });

function sharing(overrides: Partial<BoardSharingDto> = {}): BoardSharingDto {
  return {
    members: [
      { user: publicUser(me), role: 'OWNER', addedAt: NOW },
      { user: publicUser(bob), role: 'EDITOR', addedAt: NOW },
    ],
    pending: [{ id: 's1', email: 'carol@example.com', role: 'VIEWER', invitedBy: publicUser(me), createdAt: NOW }],
    workspaceAccess: 'VIEWER',
    links: [],
    ...overrides,
  };
}

const link: ShareLinkDto = {
  id: 'l1',
  boardId: 'b1',
  role: 'EDITOR',
  token: 'tok123',
  url: 'http://localhost:5173/s/tok123',
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  createdAt: NOW,
  createdBy: publicUser(me),
  lastUsedAt: null,
};

function routes(extra: MockRoute[] = []): MockRoute[] {
  return [
    ...extra,
    { method: 'GET', path: '/auth/me', respond: { body: { user: me } } },
    { method: 'GET', path: '/boards/b1/sharing', respond: { body: sharing() } },
  ];
}

beforeEach(() => {
  __resetClientStateForTests();
  document.cookie = 'inkflow_csrf=csrf; path=/';
});

/** user-event installs a clipboard stub on `setup()`; read what the app wrote to it. */
const clipboardText = () => navigator.clipboard.readText();

function renderDialog() {
  return renderWithProviders(
    <ShareDialog boardId="b1" open onOpenChange={() => {}} role="OWNER" boardTitle="Roadmap" />,
  );
}

describe('ShareDialog', () => {
  it('lists members with roles and pending invitations', async () => {
    installFetchMock(routes());
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Share “Roadmap”' });
    const members = await within(dialog).findAllByTestId('share-member');
    expect(members).toHaveLength(2);
    expect(members[0]).toHaveTextContent('Ada Lovelace (you)');
    expect(members[0]).toHaveTextContent('Owner');
    expect(within(members[1]!).getByLabelText('Role for Bob Builder')).toHaveValue('EDITOR');
    expect(within(dialog).getByTestId('share-pending')).toHaveTextContent('carol@example.com');
    expect(within(dialog).getByLabelText('Workspace access')).toHaveValue('VIEWER');
  });

  it('creates a share link with the chosen role and expiry, then copies it', async () => {
    const mock = installFetchMock(routes([{ method: 'POST', path: '/boards/b1/share-links', respond: { body: link } }]));
    const user = userEvent.setup();
    renderDialog();
    await screen.findAllByTestId('share-member');

    await user.selectOptions(screen.getByTestId('share-link-role'), 'EDITOR');
    await user.selectOptions(screen.getByTestId('share-link-expiry'), '168');
    await user.click(screen.getByTestId('share-link-create'));

    expect(await screen.findByTestId('share-link-url')).toHaveValue('http://localhost:5173/s/tok123');
    const [create] = mock.callsTo('POST', '/boards/b1/share-links');
    expect(create!.body).toEqual({ role: 'EDITOR', expiresInHours: 168 });
    expect(create!.headers.get('x-csrf-token')).toBe('csrf');
    await waitFor(async () => expect(await clipboardText()).toBe('http://localhost:5173/s/tok123'));
    expect(screen.getByTestId('share-link')).toHaveTextContent('Can edit');
    expect(screen.getByTestId('share-link')).toHaveTextContent('not used yet');
  });

  it('copies and revokes existing links', async () => {
    const mock = installFetchMock([
      { method: 'GET', path: '/boards/b1/sharing', respond: { body: sharing({ links: [link] }) } },
      { method: 'DELETE', path: '/boards/b1/share-links/l1', respond: { body: { ok: true } } },
      ...routes(),
    ]);
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByTestId('share-link-copy'));
    await waitFor(async () => expect(await clipboardText()).toBe(link.url));
    expect(screen.getByTestId('share-link-copy')).toHaveAccessibleName('Copied');
    await user.click(screen.getByTestId('share-link-revoke'));
    await waitFor(() => expect(screen.queryByTestId('share-link')).not.toBeInTheDocument());
    expect(mock.callsTo('DELETE', '/boards/b1/share-links/l1')).toHaveLength(1);
  });

  it('invites people by email with a role and optional message', async () => {
    const updated = sharing({
      pending: [
        ...sharing().pending,
        { id: 's2', email: 'dan@example.com', role: 'VIEWER', invitedBy: publicUser(me), createdAt: NOW },
      ],
    });
    const mock = installFetchMock(routes([{ method: 'POST', path: '/boards/b1/shares', respond: { body: updated } }]));
    const user = userEvent.setup();
    renderDialog();
    await screen.findAllByTestId('share-member');

    await user.type(screen.getByTestId('share-invite-email'), 'Dan@Example.com');
    await user.selectOptions(screen.getByTestId('share-invite-role'), 'VIEWER');
    await user.type(screen.getByTestId('share-invite-message'), 'Have a look!');
    await user.click(screen.getByTestId('share-invite-submit'));

    await waitFor(() => expect(screen.getAllByTestId('share-pending')).toHaveLength(2));
    expect(mock.callsTo('POST', '/boards/b1/shares')[0]!.body).toEqual({
      email: 'dan@example.com',
      role: 'VIEWER',
      message: 'Have a look!',
    });
    expect(screen.getByTestId('share-invite-email')).toHaveValue('');
  });

  it('lets the owner change roles and workspace access', async () => {
    const mock = installFetchMock(
      routes([
        {
          method: 'PATCH',
          path: '/boards/b1/members/u2',
          respond: {
            body: sharing({
              members: [
                { user: publicUser(me), role: 'OWNER', addedAt: NOW },
                { user: publicUser(bob), role: 'VIEWER', addedAt: NOW },
              ],
            }),
          },
        },
        { method: 'PATCH', path: '/boards/b1', respond: { body: makeBoard({ workspaceAccess: 'EDITOR' }) } },
      ]),
    );
    const user = userEvent.setup();
    renderDialog();
    await user.selectOptions(await screen.findByLabelText('Role for Bob Builder'), 'VIEWER');
    await waitFor(() => expect(screen.getByLabelText('Role for Bob Builder')).toHaveValue('VIEWER'));
    expect(mock.callsTo('PATCH', '/boards/b1/members/u2')[0]!.body).toEqual({ role: 'VIEWER' });

    await user.selectOptions(screen.getByLabelText('Workspace access'), 'EDITOR');
    await waitFor(() => expect(mock.callsTo('PATCH', '/boards/b1')).toHaveLength(1));
    expect(mock.callsTo('PATCH', '/boards/b1')[0]!.body).toEqual({ workspaceAccess: 'EDITOR' });
  });

  it('hides owner-only controls from editors', async () => {
    installFetchMock(routes());
    renderWithProviders(<ShareDialog boardId="b1" open onOpenChange={() => {}} role="EDITOR" />);
    await screen.findAllByTestId('share-member');
    expect(screen.queryByLabelText('Role for Bob Builder')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace access')).not.toBeInTheDocument();
    expect(screen.getByText(/Only the owner can change this/)).toBeInTheDocument();
  });
});
