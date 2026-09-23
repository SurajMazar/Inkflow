import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommentDto, CommentReplyDto, NotificationListDto, PublicUserDto, ShareLinkDto } from '@inkflow/shared';
import { createBoard, signUp, startApp, TestClient, waitForEmail, type TestApp } from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t?.close();
});

describe('comments', () => {
  it('supports threads, mentions, notifications and resolution', async () => {
    const owner = await signUp(t.url, 'Thread Owner');
    const alice = await signUp(t.url, 'Alice Commenter');
    const bob = await signUp(t.url, 'Bob Mentioned');
    const outsider = await signUp(t.url, 'Outsider');
    const board = await createBoard(owner, { title: 'Discussed' });
    await owner.post(`/api/boards/${board.id}/shares`, { email: alice.user!.email, role: 'VIEWER' });
    await owner.post(`/api/boards/${board.id}/shares`, { email: bob.user!.email, role: 'EDITOR' });

    // Mention search only finds users with access to the board.
    const found = await alice.get<PublicUserDto[]>('/api/users/search', { query: { q: 'Bob', boardId: board.id } });
    expect(found.body.map((u) => u.id)).toEqual([bob.user!.id]);
    const notFound = await alice.get<PublicUserDto[]>('/api/users/search', { query: { q: 'Outsider', boardId: board.id } });
    expect(notFound.body).toEqual([]);

    // Viewers can comment; mentioning a user without access is ignored.
    const body = `Looks good @[Bob Mentioned](${bob.user!.id}) and @[Outsider](${outsider.user!.id})`;
    const created = await alice.post<CommentDto>(`/api/boards/${board.id}/comments`, {
      body,
      anchor: { type: 'point', x: 10, y: 20 },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ body, anchor: { type: 'point', x: 10, y: 20 }, mentions: [bob.user!.id], replies: [] });

    const bobNotes = await bob.get<NotificationListDto>('/api/notifications');
    const mention = bobNotes.body.items.find((n) => n.type === 'MENTION')!;
    expect(mention).toMatchObject({ actor: { id: alice.user!.id }, link: `/b/${board.id}?comment=${created.body.id}` });
    await waitForEmail(bob.user!.email, 'mentioned you');
    const ownerNotes = await owner.get<NotificationListDto>('/api/notifications');
    expect(ownerNotes.body.items.some((n) => n.type === 'COMMENT_CREATED')).toBe(true);
    expect((await outsider.get<NotificationListDto>('/api/notifications')).body.items).toHaveLength(0);

    // Replies notify thread participants.
    const reply = await bob.post<CommentReplyDto>(`/api/comments/${created.body.id}/replies`, { body: 'Thanks!' });
    expect(reply.status).toBe(201);
    const aliceNotes = await alice.get<NotificationListDto>('/api/notifications');
    expect(aliceNotes.body.items.some((n) => n.type === 'COMMENT_REPLY')).toBe(true);

    // Only authors edit.
    expect((await bob.patch(`/api/comments/${created.body.id}`, { body: 'edited by bob' })).status).toBe(403);
    const edited = await alice.patch<CommentDto>(`/api/comments/${created.body.id}`, { body: 'Edited comment' });
    expect(edited.body.body).toBe('Edited comment');
    expect(edited.body.mentions).toEqual([]);
    expect(edited.body.replies).toHaveLength(1);
    expect((await alice.patch(`/api/comment-replies/${reply.body.id}`, { body: 'nope' })).status).toBe(403);
    expect((await bob.patch<CommentReplyDto>(`/api/comment-replies/${reply.body.id}`, { body: 'Thanks a lot!' })).body.body).toBe('Thanks a lot!');

    // Resolve / reopen.
    const resolved = await owner.post<CommentDto>(`/api/comments/${created.body.id}/resolve`);
    expect(resolved.body.resolvedBy?.id).toBe(owner.user!.id);
    expect((await alice.get<NotificationListDto>('/api/notifications')).body.items.some((n) => n.type === 'COMMENT_RESOLVED')).toBe(true);
    expect((await alice.get<CommentDto[]>(`/api/boards/${board.id}/comments`)).body).toHaveLength(0);
    expect((await alice.get<CommentDto[]>(`/api/boards/${board.id}/comments`, { query: { includeResolved: 'true' } })).body).toHaveLength(1);
    const reopened = await alice.post<CommentDto>(`/api/comments/${created.body.id}/reopen`);
    expect(reopened.body.resolvedAt).toBeNull();

    // Anonymous share-link visitors can read but not comment.
    const link = await owner.post<ShareLinkDto>(`/api/boards/${board.id}/share-links`, { role: 'EDITOR' });
    const anon = new TestClient(t.url);
    const headers = { 'x-share-token': link.body.token };
    expect((await anon.get<CommentDto[]>(`/api/boards/${board.id}/comments`, { headers })).body).toHaveLength(1);
    expect((await anon.post(`/api/comments/${created.body.id}/replies`, { body: 'anon' }, { headers })).status).toBe(401);
    // Strangers see nothing.
    expect((await outsider.get(`/api/boards/${board.id}/comments`)).status).toBe(404);
    expect((await outsider.post(`/api/comments/${created.body.id}/replies`, { body: 'x' })).status).toBe(404);

    // Notifications can be marked read.
    const unread = (await bob.get<NotificationListDto>('/api/notifications')).body;
    expect(unread.unreadCount).toBeGreaterThan(0);
    expect((await bob.post(`/api/notifications/${unread.items[0]!.id}/read`)).status).toBe(200);
    expect((await bob.post('/api/notifications/read-all')).status).toBe(200);
    expect((await bob.get<NotificationListDto>('/api/notifications')).body.unreadCount).toBe(0);

    // Deletion: replies by author or board owner; comments by author or owner.
    expect((await alice.delete(`/api/comment-replies/${reply.body.id}`)).status).toBe(403);
    expect((await owner.delete(`/api/comment-replies/${reply.body.id}`)).status).toBe(200);
    expect((await bob.delete(`/api/comments/${created.body.id}`)).status).toBe(403);
    expect((await owner.delete(`/api/comments/${created.body.id}`)).status).toBe(200);
    expect((await owner.get<CommentDto[]>(`/api/boards/${board.id}/comments`)).body).toHaveLength(0);
  });
});
