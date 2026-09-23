import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLOSE_CODES, presenceKey } from '@inkflow/collaboration';
import type { ShareLinkDto } from '@inkflow/shared';
import { RedisService } from '../src/redis/redis.service';
import {
  createBoard,
  createOp,
  element,
  eventually,
  joinBoard,
  moveOp,
  openSocket,
  signUp,
  sleep,
  startApp,
  type TestApp,
} from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t?.close();
});

describe('collaboration WebSocket', () => {
  it('broadcasts committed changes, acks the sender, relays presence and transient updates', async () => {
    const owner = await signUp(t.url, 'Socket Owner');
    const peer = await signUp(t.url, 'Socket Peer');
    const board = await createBoard(owner);
    await owner.post(`/api/boards/${board.id}/shares`, { email: peer.user!.email, role: 'EDITOR' });

    const a = await joinBoard(t.wsUrl, { boardId: board.id, cookie: owner.cookieHeader() });
    expect(a.welcome).toMatchObject({ protocol: 1, role: 'OWNER', seq: 0, peers: [], missed: [] });
    expect(a.welcome.user).toMatchObject({
      id: owner.user!.id,
      name: 'Socket Owner',
      anonymous: false,
    });

    const b = await joinBoard(t.wsUrl, { boardId: board.id, cookie: peer.cookieHeader() });
    expect(b.welcome.role).toBe('EDITOR');
    expect(b.welcome.peers.map((p) => p.clientId)).toEqual([a.clientId]);
    // A is told about B joining.
    const joined = await a.socket.next('presence', (m) => m.peer.clientId === b.clientId);
    expect(joined.peer.user.name).toBe('Socket Peer');

    // Ops: ack to sender, changes to everyone (sender included).
    const rect = element('rectangle', { id: 'ws-rect' });
    a.socket.send({ t: 'ops', batchId: 'batch-1', ops: [createOp(a.clientId, rect)] });
    const ack = await a.socket.next('ack');
    expect(ack).toMatchObject({ batchId: 'batch-1', results: [{ status: 'applied', seq: 1 }] });
    const changesA = await a.socket.next('changes');
    const changesB = await b.socket.next('changes');
    expect(changesB.changes[0]).toMatchObject({
      seq: 1,
      clientId: a.clientId,
      userId: owner.user!.id,
      type: 'CREATE_ELEMENT',
    });
    expect(changesB.changes[0]!.elements[0]).toMatchObject({ id: 'ws-rect', version: 2 });
    expect(changesA.changes[0]!.seq).toBe(1);
    // Persisted.
    const row = await t.prisma.boardElement.findUnique({
      where: { boardId_elementId: { boardId: board.id, elementId: 'ws-rect' } },
    });
    expect(row?.version).toBe(2);

    // Resending the same op is reported as duplicate and not broadcast again.
    const again = createOp(a.clientId, rect);
    a.socket.send({ t: 'ops', batchId: 'batch-2', ops: [again] });
    await a.socket.next('ack', (m) => m.batchId === 'batch-2');
    a.socket.send({ t: 'ops', batchId: 'batch-3', ops: [again] });
    const dupAck = await a.socket.next('ack', (m) => m.batchId === 'batch-3');
    expect(dupAck.results[0]).toMatchObject({ status: 'duplicate', seq: 2 });

    // Presence is relayed and stored in Redis.
    b.socket.send({ t: 'presence', state: { cursor: { x: 5, y: 6 }, selectedIds: ['ws-rect'] } });
    const presence = await a.socket.next(
      'presence',
      (m) => m.peer.clientId === b.clientId && m.peer.state.cursor?.x === 5,
    );
    expect(presence.peer.state.selectedIds).toEqual(['ws-rect']);
    const stored = await t.app.get(RedisService).client.hget(presenceKey(board.id), b.clientId);
    expect(JSON.parse(stored!).state.cursor).toEqual({ x: 5, y: 6 });

    // Transient updates reach peers only and are never persisted.
    b.socket.send({ t: 'transient', elements: [{ ...rect, x: 999 }] });
    const transient = await a.socket.next('transient');
    expect(transient.clientId).toBe(b.clientId);
    expect(transient.elements[0]).toMatchObject({ id: 'ws-rect', x: 999 });
    await b.socket.expectNone('transient', 200);
    const unchanged = await t.prisma.boardElement.findUniqueOrThrow({
      where: { boardId_elementId: { boardId: board.id, elementId: 'ws-rect' } },
    });
    expect((unchanged.data as { x: number }).x).toBe(10);

    // Ping / pong.
    a.socket.send({ t: 'ping', ts: 42 });
    expect((await a.socket.next('pong')).ts).toBe(42);

    // Leaving produces peer-left and clears presence.
    b.socket.close();
    const left = await a.socket.next('peer-left');
    expect(left.clientId).toBe(b.clientId);
    await eventually(
      async () =>
        (await t.app.get(RedisService).client.hget(presenceKey(board.id), b.clientId)) === null,
    );
    a.socket.close();
  });

  it('replays missed changes on reconnect with lastSeq', async () => {
    const owner = await signUp(t.url, 'Reconnector');
    const board = await createBoard(owner);
    const first = await joinBoard(t.wsUrl, { boardId: board.id, cookie: owner.cookieHeader() });
    first.socket.send({
      t: 'ops',
      batchId: '1',
      ops: [
        createOp(first.clientId, element('rectangle', { id: 'm1' })),
        createOp(first.clientId, element('ellipse', { id: 'm2' })),
      ],
    });
    await first.socket.next('ack');
    const seqBefore = 2;
    first.socket.close();
    await first.socket.closed;

    // Someone else edits while we are offline (HTTP fallback).
    await owner.post(`/api/boards/${board.id}/operations`, {
      clientId: 'other',
      batchId: 'x',
      ops: [moveOp('other', 'm1', 77, 88), createOp('other', element('diamond', { id: 'm3' }))],
    });

    const back = await joinBoard(t.wsUrl, {
      boardId: board.id,
      cookie: owner.cookieHeader(),
      clientId: first.clientId,
      lastSeq: seqBefore,
    });
    expect(back.welcome.seq).toBe(4);
    const missed = back.welcome.missed!;
    expect(missed.map((c) => c.seq)).toEqual([3, 4]);
    const ids = missed.flatMap((c) => c.elements.map((e) => e.id)).sort();
    expect(ids).toEqual(['m1', 'm3']);
    expect(missed[0]!.elements[0]).toMatchObject({ id: 'm1', x: 77, y: 88 });

    // sync returns the same; a compacted log asks for a resync.
    back.socket.send({ t: 'sync', sinceSeq: 3 });
    const synced = await back.socket.next('changes');
    expect(synced.changes.map((c) => c.seq)).toEqual([4]);
    await t.prisma.boardOperation.deleteMany({ where: { boardId: board.id } });
    back.socket.send({ t: 'sync', sinceSeq: 0 });
    expect((await back.socket.next('resync')).reason).toBeTruthy();
    back.socket.close();
    const fresh = await joinBoard(t.wsUrl, {
      boardId: board.id,
      cookie: owner.cookieHeader(),
      lastSeq: 1,
    });
    expect(fresh.welcome.missed).toBeNull();
    fresh.socket.close();
  });

  it('enforces authentication and roles for sockets', async () => {
    const owner = await signUp(t.url, 'Socket Guard');
    const board = await createBoard(owner);

    // No credentials → 4401; unknown board → 4404; stranger → 4404.
    const anon = openSocket(t.wsUrl, { boardId: board.id });
    expect((await anon.closed).code).toBe(CLOSE_CODES.UNAUTHORIZED);
    const bogus = openSocket(t.wsUrl, {
      boardId: '00000000-0000-4000-8000-000000000000',
      cookie: owner.cookieHeader(),
    });
    expect((await bogus.closed).code).toBe(CLOSE_CODES.NOT_FOUND);
    const stranger = await signUp(t.url, 'Socket Stranger');
    const strangerSocket = openSocket(t.wsUrl, {
      boardId: board.id,
      cookie: stranger.cookieHeader(),
    });
    expect((await strangerSocket.closed).code).toBe(CLOSE_CODES.NOT_FOUND);
    const badCookie = openSocket(t.wsUrl, { boardId: board.id, cookie: 'inkflow_at=garbage' });
    expect((await badCookie.closed).code).toBe(CLOSE_CODES.UNAUTHORIZED);

    // Protocol mismatch.
    const old = openSocket(t.wsUrl, { boardId: board.id, cookie: owner.cookieHeader() });
    await old.opened;
    old.send({ t: 'hello', protocol: 99, boardId: board.id, clientId: 'old', lastSeq: 0 });
    expect((await old.closed).code).toBe(CLOSE_CODES.PROTOCOL_MISMATCH);

    // Anonymous viewer via share link: guest identity, cannot send ops or transient updates.
    const link = await owner.post<ShareLinkDto>(`/api/boards/${board.id}/share-links`, {
      role: 'VIEWER',
    });
    const guest = await joinBoard(t.wsUrl, { boardId: board.id, st: link.body.token });
    expect(guest.welcome.role).toBe('VIEWER');
    expect(guest.welcome.user.anonymous).toBe(true);
    expect(guest.welcome.user.name).toMatch(/^Guest /);
    guest.socket.send({
      t: 'ops',
      batchId: 'nope',
      ops: [createOp(guest.clientId, element('rectangle', { id: 'guest-rect' }))],
    });
    const rejected = await guest.socket.next('ack');
    expect(rejected.results[0]).toMatchObject({ status: 'rejected', reason: 'FORBIDDEN' });
    expect((await guest.socket.next('error')).code).toBe('FORBIDDEN');
    guest.socket.send({ t: 'transient', elements: [{ id: 'guest-rect' }] });
    expect((await guest.socket.next('error')).code).toBe('FORBIDDEN');
    expect(await t.prisma.boardElement.count({ where: { boardId: board.id } })).toBe(0);
    // Viewers still share presence.
    const ownerSocket = await joinBoard(t.wsUrl, {
      boardId: board.id,
      cookie: owner.cookieHeader(),
    });
    expect(ownerSocket.welcome.peers.map((p) => p.clientId)).toContain(guest.clientId);

    // Revoking the link disconnects the guest immediately.
    await owner.delete(`/api/boards/${board.id}/share-links/${link.body.id}`);
    expect((await guest.socket.closed).code).toBe(CLOSE_CODES.FORBIDDEN);

    // Deleting the board closes remaining sockets with BOARD_DELETED.
    const deletedEvent = ownerSocket.socket.next('event', (m) => m.event.kind === 'board-deleted');
    await owner.delete(`/api/boards/${board.id}`);
    await deletedEvent;
    expect((await ownerSocket.socket.closed).code).toBe(CLOSE_CODES.BOARD_DELETED);
  });

  it('applies permission downgrades immediately and relays board events', async () => {
    const owner = await signUp(t.url, 'Downgrader');
    const editor = await signUp(t.url, 'Soon Viewer');
    const board = await createBoard(owner);
    await owner.post(`/api/boards/${board.id}/shares`, {
      email: editor.user!.email,
      role: 'EDITOR',
    });
    const e = await joinBoard(t.wsUrl, { boardId: board.id, cookie: editor.cookieHeader() });
    expect(e.welcome.role).toBe('EDITOR');

    await owner.patch(`/api/boards/${board.id}`, { title: 'Renamed live' });
    const renamed = await e.socket.next('event', (m) => m.event.kind === 'board-renamed');
    expect(renamed.event).toEqual({ kind: 'board-renamed', title: 'Renamed live' });

    await owner.patch(`/api/boards/${board.id}/members/${editor.user!.id}`, { role: 'VIEWER' });
    await e.socket.next('event', (m) => m.event.kind === 'permissions-changed');
    await sleep(100);
    e.socket.send({
      t: 'ops',
      batchId: 'after-downgrade',
      ops: [createOp(e.clientId, element('rectangle'))],
    });
    const ack = await e.socket.next('ack', (m) => m.batchId === 'after-downgrade');
    expect(ack.results[0]!.status).toBe('rejected');

    await owner.post(`/api/boards/${board.id}/comments`, {
      body: 'ping',
      anchor: { type: 'point', x: 0, y: 0 },
    });
    const commentEvent = await e.socket.next('event', (m) => m.event.kind === 'comments-changed');
    expect(commentEvent.event.kind).toBe('comments-changed');

    // Removing the member entirely closes the socket.
    await owner.delete(`/api/boards/${board.id}/members/${editor.user!.id}`);
    expect((await e.socket.closed).code).toBe(CLOSE_CODES.FORBIDDEN);
  });

  it('fans out across API instances through Redis', async () => {
    const second = await startApp();
    try {
      const owner = await signUp(t.url, 'Multi Instance');
      const board = await createBoard(owner);
      const onFirst = await joinBoard(t.wsUrl, { boardId: board.id, cookie: owner.cookieHeader() });
      const onSecond = await joinBoard(second.wsUrl, {
        boardId: board.id,
        cookie: owner.cookieHeader(),
      });
      expect(onSecond.welcome.peers.map((p) => p.clientId)).toEqual([onFirst.clientId]);
      onFirst.socket.send({
        t: 'ops',
        batchId: 'x',
        ops: [createOp(onFirst.clientId, element('star', { id: 'far' }))],
      });
      const remote = await onSecond.socket.next('changes');
      expect(remote.changes[0]!.elements[0]!.id).toBe('far');
      onSecond.socket.send({ t: 'transient', elements: [{ id: 'far', x: 1 }] });
      expect((await onFirst.socket.next('transient')).clientId).toBe(onSecond.clientId);
      onSecond.socket.close();
      expect((await onFirst.socket.next('peer-left')).clientId).toBe(onSecond.clientId);
      onFirst.socket.close();
    } finally {
      await second.close();
    }
  });

  it('closes sockets with GOING_AWAY and cleans presence on graceful shutdown', async () => {
    const instance = await startApp();
    const owner = await signUp(instance.url, 'Shutdown');
    const board = await createBoard(owner);
    const s = await joinBoard(instance.wsUrl, { boardId: board.id, cookie: owner.cookieHeader() });
    const redis = t.app.get(RedisService).client;
    expect(await redis.hexists(presenceKey(board.id), s.clientId)).toBe(1);
    await instance.close();
    expect((await s.socket.closed).code).toBe(CLOSE_CODES.GOING_AWAY);
    expect(await redis.hexists(presenceKey(board.id), s.clientId)).toBe(0);
  });

  it('asks collaborators to resync after a version restore', async () => {
    const owner = await signUp(t.url, 'Restorer');
    const board = await createBoard(owner);
    const s = await joinBoard(t.wsUrl, { boardId: board.id, cookie: owner.cookieHeader() });
    s.socket.send({
      t: 'ops',
      batchId: '1',
      ops: [createOp(s.clientId, element('rectangle', { id: 'keep' }))],
    });
    await s.socket.next('ack');
    const version = await owner.post<{ id: string }>(`/api/boards/${board.id}/versions`, {
      label: 'v',
    });
    await owner.post(`/api/boards/${board.id}/versions/${version.body.id}/restore`);
    expect((await s.socket.next('resync')).reason).toBe('version-restored');
    const event = await s.socket.next('event', (m) => m.event.kind === 'version-restored');
    expect(event.event).toEqual({ kind: 'version-restored', versionId: version.body.id });
    s.socket.close();
  });
});
