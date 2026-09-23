import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BoardDetailDto,
  BoardSharingDto,
  BoardSummaryDto,
  NotificationListDto,
  ResolvedShareLinkDto,
  ShareLinkDto,
  WorkspaceDto,
} from '@inkflow/shared';
import {
  createBoard,
  createOp,
  element,
  PASSWORD,
  personalWorkspace,
  signUp,
  startApp,
  TestClient,
  tokenFromText,
  uniqueEmail,
  waitForEmail,
  type TestApp,
} from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t?.close();
});

const opsBody = (clientId: string) => ({
  clientId,
  batchId: 'b1',
  ops: [createOp(clientId, element('rectangle'))],
});

describe('permissions', () => {
  it('hides boards from strangers and enforces viewer/editor/owner roles', async () => {
    const owner = await signUp(t.url, 'Perm Owner');
    const board = await createBoard(owner);
    const stranger = await signUp(t.url, 'Perm Stranger');
    expect((await stranger.get(`/api/boards/${board.id}`)).status).toBe(404);
    expect((await stranger.post(`/api/boards/${board.id}/operations`, opsBody('s'))).status).toBe(
      404,
    );
    expect((await stranger.get(`/api/boards/${board.id}/comments`)).status).toBe(404);

    // Share as viewer with an existing user.
    const viewer = await signUp(t.url, 'Perm Viewer');
    const shared = await owner.post<BoardSharingDto>(`/api/boards/${board.id}/shares`, {
      email: viewer.user!.email,
      role: 'VIEWER',
    });
    expect(shared.status).toBe(201);
    expect(shared.body.members.map((m) => m.role).sort()).toEqual(['OWNER', 'VIEWER']);
    const notes = await viewer.get<NotificationListDto>('/api/notifications');
    expect(notes.body.items[0]).toMatchObject({ type: 'BOARD_SHARED' });
    expect(notes.body.unreadCount).toBeGreaterThan(0);

    const detail = await viewer.get<BoardDetailDto>(`/api/boards/${board.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.board.role).toBe('VIEWER');
    const sharedList = await viewer.get<BoardSummaryDto[]>('/api/boards', {
      query: { filter: 'shared' },
    });
    expect(sharedList.body.map((b) => b.id)).toEqual([board.id]);
    expect((await viewer.post(`/api/boards/${board.id}/operations`, opsBody('v'))).status).toBe(
      403,
    );
    expect((await viewer.patch(`/api/boards/${board.id}`, { title: 'Hacked' })).status).toBe(403);
    expect((await viewer.get(`/api/boards/${board.id}/sharing`)).status).toBe(403);
    expect((await viewer.delete(`/api/boards/${board.id}`)).status).toBe(403);

    // Promote to editor: can edit, cannot delete or change workspace access, cannot grant OWNER.
    const viewerId = viewer.user!.id;
    await owner.patch(`/api/boards/${board.id}/members/${viewerId}`, { role: 'EDITOR' });
    expect((await viewer.post(`/api/boards/${board.id}/operations`, opsBody('v'))).status).toBe(
      200,
    );
    expect(
      (await viewer.patch<BoardSummaryDto>(`/api/boards/${board.id}`, { title: 'Edited' })).body
        .title,
    ).toBe('Edited');
    expect(
      (await viewer.patch(`/api/boards/${board.id}`, { workspaceAccess: 'NONE' })).status,
    ).toBe(403);
    expect((await viewer.delete(`/api/boards/${board.id}`)).status).toBe(403);
    expect(
      (await viewer.patch(`/api/boards/${board.id}/members/${viewerId}`, { role: 'OWNER' })).status,
    ).toBe(403);
    expect(
      (
        await viewer.post(`/api/boards/${board.id}/shares`, {
          email: uniqueEmail('x'),
          role: 'OWNER',
        })
      ).status,
    ).toBe(400);

    // Members can leave.
    const left = await viewer.delete<BoardSharingDto>(
      `/api/boards/${board.id}/members/${viewerId}`,
    );
    expect(left.status).toBe(200);
    expect((await viewer.get(`/api/boards/${board.id}`)).status).toBe(404);
  });

  it('derives access from workspace membership and workspaceAccess', async () => {
    const owner = await signUp(t.url, 'WS Owner');
    const ws = (await owner.post<WorkspaceDto>('/api/workspaces', { name: 'Shared WS' })).body;
    const board = await createBoard(owner, { workspaceId: ws.id });
    const member = await signUp(t.url, 'WS Member');
    await owner.post(`/api/workspaces/${ws.id}/invitations`, { email: member.user!.email });

    expect((await member.get<BoardDetailDto>(`/api/boards/${board.id}`)).body.board.role).toBe(
      'EDITOR',
    );
    await owner.patch(`/api/boards/${board.id}`, { workspaceAccess: 'VIEWER' });
    expect((await member.get<BoardDetailDto>(`/api/boards/${board.id}`)).body.board.role).toBe(
      'VIEWER',
    );
    await owner.patch(`/api/boards/${board.id}`, { workspaceAccess: 'NONE' });
    expect((await member.get(`/api/boards/${board.id}`)).status).toBe(404);

    // Workspace admins own every board of the workspace.
    await owner.patch(`/api/workspaces/${ws.id}/members/${member.user!.id}`, { role: 'ADMIN' });
    expect((await member.get<BoardDetailDto>(`/api/boards/${board.id}`)).body.board.role).toBe(
      'OWNER',
    );
    expect((await member.delete(`/api/boards/${board.id}`)).status).toBe(200);
  });

  it('grants share-link roles to anonymous visitors and honours revocation and expiry', async () => {
    const owner = await signUp(t.url, 'Link Owner');
    const board = await createBoard(owner, { title: 'Linked' });
    const link = await owner.post<ShareLinkDto>(`/api/boards/${board.id}/share-links`, {
      role: 'VIEWER',
    });
    expect(link.status).toBe(201);
    expect(link.body.url).toBe(`http://localhost:5173/s/${link.body.token}`);
    const sharing = await owner.get<BoardSharingDto>(`/api/boards/${board.id}/sharing`);
    expect(sharing.body.links[0]!.token).toBe(link.body.token);

    const anon = new TestClient(t.url);
    const resolved = await anon.get<ResolvedShareLinkDto>(`/api/share-links/${link.body.token}`);
    expect(resolved.body).toMatchObject({
      boardId: board.id,
      boardTitle: 'Linked',
      role: 'VIEWER',
      expiresAt: null,
    });
    const headers = { 'x-share-token': link.body.token };
    const detail = await anon.get<BoardDetailDto>(`/api/boards/${board.id}`, { headers });
    expect(detail.status).toBe(200);
    expect(detail.body.viaShareLink).toBe(true);
    expect(detail.body.board.role).toBe('VIEWER');
    expect(
      (await anon.get(`/api/boards/${board.id}`, { query: { st: link.body.token } })).status,
    ).toBe(200);
    expect((await anon.get(`/api/boards/${board.id}`)).status).toBe(401);
    expect(
      (await anon.post(`/api/boards/${board.id}/operations`, opsBody('anon'), { headers })).status,
    ).toBe(403);
    expect((await anon.get(`/api/boards/${board.id}/comments`, { headers })).status).toBe(200);
    const comment = await anon.post(
      `/api/boards/${board.id}/comments`,
      { body: 'hi', anchor: { type: 'point', x: 0, y: 0 } },
      { headers },
    );
    expect(comment.status).toBe(401);
    // The token only grants access to its own board.
    const other = await createBoard(owner, { title: 'Other' });
    expect((await anon.get(`/api/boards/${other.id}`, { headers })).status).toBe(404);

    // Editor links allow editing.
    const editLink = await owner.post<ShareLinkDto>(`/api/boards/${board.id}/share-links`, {
      role: 'EDITOR',
    });
    const editHeaders = { 'x-share-token': editLink.body.token };
    expect(
      (
        await anon.post(`/api/boards/${board.id}/operations`, opsBody('anon'), {
          headers: editHeaders,
        })
      ).status,
    ).toBe(200);

    // Revoked links stop working.
    expect((await owner.delete(`/api/boards/${board.id}/share-links/${link.body.id}`)).status).toBe(
      200,
    );
    expect((await anon.get(`/api/share-links/${link.body.token}`)).status).toBe(404);
    expect((await anon.get(`/api/boards/${board.id}`, { headers })).status).toBe(404);

    // Expired links stop working.
    const expiring = await owner.post<ShareLinkDto>(`/api/boards/${board.id}/share-links`, {
      role: 'VIEWER',
      expiresInHours: 1,
    });
    await t.prisma.shareLink.update({
      where: { id: expiring.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await anon.get(`/api/share-links/${expiring.body.token}`)).status).toBe(404);
    expect(
      (
        await anon.get(`/api/boards/${board.id}`, {
          headers: { 'x-share-token': expiring.body.token },
        })
      ).status,
    ).toBe(404);
    // Tokens are stored hashed + encrypted, never in plain text.
    const row = await t.prisma.shareLink.findUniqueOrThrow({ where: { id: expiring.body.id } });
    expect(row.tokenHash).not.toBe(expiring.body.token);
    expect(row.tokenCiphertext).not.toContain(expiring.body.token);
  });

  it('turns pending email shares into memberships when the address is verified', async () => {
    const owner = await signUp(t.url, 'Pending Owner');
    const board = await createBoard(owner, { title: 'For newcomer' });
    const email = uniqueEmail('newcomer');
    const pending = await owner.post<BoardSharingDto>(`/api/boards/${board.id}/shares`, {
      email,
      role: 'EDITOR',
      message: 'Welcome!',
    });
    expect(pending.body.pending).toHaveLength(1);
    await waitForEmail(email, 'shared “For newcomer” with you');

    const newcomer = new TestClient(t.url);
    await newcomer.get('/api/auth/csrf');
    await newcomer.post('/api/auth/register', { email, password: PASSWORD, name: 'Newcomer' });
    const mail = await waitForEmail(email, 'Verify your email');
    await newcomer.post('/api/auth/verify-email', { token: tokenFromText(mail.text) });
    const detail = await newcomer.get<BoardDetailDto>(`/api/boards/${board.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.board.role).toBe('EDITOR');
    const notes = await newcomer.get<NotificationListDto>('/api/notifications');
    expect(notes.body.items.some((n) => n.type === 'BOARD_SHARED')).toBe(true);
    const after = await owner.get<BoardSharingDto>(`/api/boards/${board.id}/sharing`);
    expect(after.body.pending).toHaveLength(0);
    expect(after.body.members).toHaveLength(2);

    // Revoking a pending share.
    const again = await owner.post<BoardSharingDto>(`/api/boards/${board.id}/shares`, {
      email: uniqueEmail('later'),
    });
    const revoked = await owner.delete<BoardSharingDto>(
      `/api/boards/${board.id}/shares/${again.body.pending[0]!.id}`,
    );
    expect(revoked.body.pending).toHaveLength(0);
    const ws = await personalWorkspace(owner);
    expect(ws.boardCount).toBeGreaterThan(0);
  });
});
