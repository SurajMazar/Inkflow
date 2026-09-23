import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BoardSummaryDto,
  FolderDto,
  InviteMemberResponse,
  NotificationListDto,
  ProjectDto,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@inkflow/shared';
import {
  createBoard,
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

describe('workspaces', () => {
  it('creates a personal workspace on sign-up and supports CRUD', async () => {
    const owner = await signUp(t.url, 'Grace Hopper');
    const list = await owner.get<WorkspaceDto[]>('/api/workspaces');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      name: "Grace's workspace",
      role: 'OWNER',
      memberCount: 1,
      boardCount: 0,
    });

    const created = await owner.post<WorkspaceDto>('/api/workspaces', { name: 'Acme Engineering' });
    expect(created.status).toBe(201);
    expect(created.body.slug).toMatch(/^acme-engineering-[0-9a-f]{6}$/);
    const renamed = await owner.patch<WorkspaceDto>(`/api/workspaces/${created.body.id}`, {
      name: 'Acme Eng',
    });
    expect(renamed.body.name).toBe('Acme Eng');
    expect((await owner.delete(`/api/workspaces/${created.body.id}`)).status).toBe(200);
    expect((await owner.get(`/api/workspaces/${created.body.id}`)).status).toBe(404);
    expect((await owner.get('/api/workspaces/not-a-uuid')).status).toBe(404);
  });

  it('invites existing and new users, changes roles and removes members', async () => {
    const owner = await signUp(t.url, 'Owner One');
    const ws = (await owner.post<WorkspaceDto>('/api/workspaces', { name: 'Team' })).body;

    // Existing (verified) user → added directly and notified.
    const bob = await signUp(t.url, 'Bob Builder');
    const added = await owner.post<InviteMemberResponse>(`/api/workspaces/${ws.id}/invitations`, {
      email: bob.user!.email,
    });
    expect(added.status).toBe(201);
    expect(added.body.status).toBe('added');
    expect(added.body.member?.role).toBe('MEMBER');
    const bobNotes = await bob.get<NotificationListDto>('/api/notifications');
    expect(bobNotes.body.items.some((n) => n.type === 'WORKSPACE_INVITE')).toBe(true);
    expect(
      (await owner.post(`/api/workspaces/${ws.id}/invitations`, { email: bob.user!.email })).status,
    ).toBe(409);

    // New email → invitation email → register → accept.
    const carolEmail = uniqueEmail('carol');
    const invited = await owner.post<InviteMemberResponse>(`/api/workspaces/${ws.id}/invitations`, {
      email: carolEmail,
      role: 'ADMIN',
    });
    expect(invited.body.status).toBe('invited');
    const pending = await owner.get<unknown[]>(`/api/workspaces/${ws.id}/invitations`);
    expect(pending.body).toHaveLength(1);
    const inviteMail = await waitForEmail(carolEmail, 'invited you to Team');
    const inviteToken = tokenFromText(inviteMail.text, /\/invite\/([A-Za-z0-9_-]+)/);
    const anon = new TestClient(t.url);
    const preview = await anon.get<{ workspaceName: string; role: string }>(
      `/api/invitations/${inviteToken}`,
    );
    expect(preview.body).toMatchObject({ workspaceName: 'Team', role: 'ADMIN', email: carolEmail });

    // A different user cannot accept it.
    expect((await bob.post(`/api/invitations/${inviteToken}/accept`)).status).toBe(403);

    const carol = new TestClient(t.url);
    await carol.get('/api/auth/csrf');
    await carol.post('/api/auth/register', {
      email: carolEmail,
      password: PASSWORD,
      name: 'Carol',
    });
    // Carol has not verified yet, but accepting via the emailed link proves the address.
    const unverifiedLogin = await carol.post('/api/auth/login', {
      email: carolEmail,
      password: PASSWORD,
    });
    expect(unverifiedLogin.status).toBe(403);
    const verifyMail = await waitForEmail(carolEmail, 'Verify your email');
    const verified = await carol.post<{ user: { id: string } }>('/api/auth/verify-email', {
      token: tokenFromText(verifyMail.text),
    });
    const carolId = verified.body.user.id;
    // Verification already converted the invitation into a membership.
    const carolWorkspaces = await carol.get<WorkspaceDto[]>('/api/workspaces');
    expect(carolWorkspaces.body.find((w) => w.id === ws.id)?.role).toBe('ADMIN');
    expect((await anon.get(`/api/invitations/${inviteToken}`)).status).toBe(404);

    const members = await owner.get<WorkspaceMemberDto[]>(`/api/workspaces/${ws.id}/members`);
    expect(members.body.map((m) => m.role).sort()).toEqual(['ADMIN', 'MEMBER', 'OWNER']);

    // ADMIN cannot grant OWNER; OWNER can.
    const bobId = bob.user!.id;
    expect(
      (await carol.patch(`/api/workspaces/${ws.id}/members/${bobId}`, { role: 'OWNER' })).status,
    ).toBe(403);
    const promoted = await carol.patch<WorkspaceMemberDto>(
      `/api/workspaces/${ws.id}/members/${bobId}`,
      { role: 'ADMIN' },
    );
    expect(promoted.body.role).toBe('ADMIN');
    // Admins can demote other admins; plain members cannot change roles.
    expect(
      (await bob.patch(`/api/workspaces/${ws.id}/members/${carolId}`, { role: 'MEMBER' })).status,
    ).toBe(200);
    expect(
      (await carol.patch(`/api/workspaces/${ws.id}/members/${bobId}`, { role: 'MEMBER' })).status,
    ).toBe(403);

    // The last owner can neither be demoted nor leave.
    const ownerId = owner.user!.id;
    expect(
      (await owner.patch(`/api/workspaces/${ws.id}/members/${ownerId}`, { role: 'ADMIN' })).status,
    ).toBe(409);
    expect((await owner.delete(`/api/workspaces/${ws.id}/members/${ownerId}`)).status).toBe(409);

    // Remove a member, and a member leaves by themselves.
    expect((await owner.delete(`/api/workspaces/${ws.id}/members/${carolId}`)).status).toBe(200);
    expect((await carol.get(`/api/workspaces/${ws.id}`)).status).toBe(404);
    expect((await bob.delete(`/api/workspaces/${ws.id}/members/${bobId}`)).status).toBe(200);
    expect(
      (await owner.get<WorkspaceMemberDto[]>(`/api/workspaces/${ws.id}/members`)).body,
    ).toHaveLength(1);

    // Revoke an invitation.
    const inv = await owner.post<InviteMemberResponse>(`/api/workspaces/${ws.id}/invitations`, {
      email: uniqueEmail('dave'),
    });
    expect(
      (await owner.delete(`/api/workspaces/${ws.id}/invitations/${inv.body.invitation!.id}`))
        .status,
    ).toBe(200);
    expect((await owner.get<unknown[]>(`/api/workspaces/${ws.id}/invitations`)).body).toHaveLength(
      0,
    );
  });

  it('manages projects and folders', async () => {
    const owner = await signUp(t.url, 'Project Person');
    const ws = await personalWorkspace(owner);
    const project = await owner.post<ProjectDto>(`/api/workspaces/${ws.id}/projects`, {
      name: 'Roadmap',
      description: 'Q4',
    });
    expect(project.status).toBe(201);
    const folder = await owner.post<FolderDto>(`/api/workspaces/${ws.id}/folders`, {
      name: 'Drafts',
      projectId: project.body.id,
    });
    const sub = await owner.post<FolderDto>(`/api/workspaces/${ws.id}/folders`, {
      name: 'Old',
      parentId: folder.body.id,
    });
    expect(sub.body.projectId).toBe(project.body.id);
    // Cycles are rejected.
    expect(
      (await owner.patch(`/api/folders/${folder.body.id}`, { parentId: sub.body.id })).status,
    ).toBe(400);

    const board = await createBoard(owner, { workspaceId: ws.id, folderId: sub.body.id });
    const listed = await owner.get<ProjectDto[]>(`/api/workspaces/${ws.id}/projects`);
    expect(listed.body[0]).toMatchObject({ name: 'Roadmap', boardCount: 1 });

    // Deleting a folder moves its boards to the parent folder.
    expect((await owner.delete(`/api/folders/${sub.body.id}`)).status).toBe(200);
    const moved = await owner.get<{ board: BoardSummaryDto }>(`/api/boards/${board.id}`);
    expect(moved.body.board.folderId).toBe(folder.body.id);
    const renamed = await owner.patch<ProjectDto>(`/api/projects/${project.body.id}`, {
      name: 'Roadmap 2',
    });
    expect(renamed.body.name).toBe('Roadmap 2');

    // Deleting a project moves its boards to the trash.
    expect((await owner.delete(`/api/projects/${project.body.id}`)).status).toBe(200);
    const trash = await owner.get<BoardSummaryDto[]>('/api/boards', { query: { filter: 'trash' } });
    expect(trash.body.map((b) => b.id)).toContain(board.id);
    expect((await owner.get<FolderDto[]>(`/api/workspaces/${ws.id}/folders`)).body).toHaveLength(0);

    // Strangers cannot see the workspace structure.
    const stranger = await signUp(t.url, 'Stranger');
    expect((await stranger.get(`/api/workspaces/${ws.id}/projects`)).status).toBe(404);
  });
});
