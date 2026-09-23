import { createElement, type SceneElement } from '@inkflow/elements';
import { applyOperation, type Operation } from '@inkflow/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CollabClient,
  type ClientMessage,
  type CollabStorage,
  type ServerMessage,
  type WebSocketLike,
} from '../src';

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: ClientMessage[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  last<T extends ClientMessage['t']>(t: T): Extract<ClientMessage, { t: T }> | undefined {
    return [...this.sent].reverse().find((m) => m.t === t) as Extract<ClientMessage, { t: T }> | undefined;
  }
}

const user = { id: 'u1', name: 'Ada', avatarUrl: null, color: '#f00', anonymous: false };

function welcome(seq: number, missed: ServerMessage extends infer M ? (M extends { t: 'welcome' } ? M['missed'] : never) : never = []): ServerMessage {
  return { t: 'welcome', protocol: 1, clientId: 'c1', role: 'EDITOR', user, seq, peers: [], missed };
}

function memoryStorage(): CollabStorage & { data: Map<string, Operation[]> } {
  const data = new Map<string, Operation[]>();
  return {
    data,
    loadPending: async (id) => data.get(id) ?? [],
    savePending: async (id, ops) => {
      data.set(id, [...ops]);
    },
  };
}

describe('CollabClient', () => {
  let sockets: FakeSocket[];
  let applied: SceneElement[][];
  const base = createElement('rectangle', { id: 'r1', x: 0, y: 0, width: 10, height: 10, index: 'a0' });

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    applied = [];
  });
  afterEach(() => vi.useRealTimers());

  function makeClient(extra: Partial<ConstructorParameters<typeof CollabClient>[0]> = {}) {
    const client = new CollabClient({
      boardId: 'b1',
      clientId: 'c1',
      url: 'ws://test',
      canEdit: true,
      initialSeq: 5,
      initialElements: [base],
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      onElements: (els) => applied.push(els),
      ...extra,
    });
    return client;
  }

  function moveOp(client: CollabClient, x: number): Operation {
    return { ...client.nextMeta(base.version), type: 'MOVE_ELEMENT', elementId: 'r1', x, y: 0 };
  }

  it('sends hello with lastSeq, batches ops after welcome and clears them on ack', async () => {
    const statuses: string[] = [];
    const client = makeClient({ onStatus: (s) => statuses.push(s.save) });
    await client.start();
    const s = sockets[0]!;
    s.open();
    expect(s.last('hello')).toMatchObject({ boardId: 'b1', lastSeq: 5 });
    s.receive(welcome(5));
    client.submit([moveOp(client, 50)]);
    expect(client.currentStatus.save).toBe('saving');
    await vi.advanceTimersByTimeAsync(100);
    const ops = s.last('ops')!;
    expect(ops.ops).toHaveLength(1);
    s.receive({ t: 'ack', batchId: ops.batchId, results: [{ opId: ops.ops[0]!.opId, status: 'applied', seq: 6 }] });
    expect(client.pendingCount).toBe(0);
    expect(client.currentStatus.save).toBe('saved');
    expect(statuses).toContain('saving');
    client.stop();
  });

  it('rebases remote changes with pending local operations', async () => {
    const client = makeClient();
    await client.start();
    const s = sockets[0]!;
    s.open();
    s.receive(welcome(5));
    client.submit([moveOp(client, 99)]);
    // A collaborator changes the color concurrently (server state).
    const remote = { ...base, strokeColor: '#00ff00', version: base.version + 1 };
    s.receive({ t: 'changes', changes: [{ seq: 6, opId: 'x', clientId: 'c2', userId: 'u2', type: 'UPDATE_ELEMENT', elements: [remote] }] });
    const last = applied.at(-1)![0]!;
    expect(last.strokeColor).toBe('#00ff00');
    expect(last.x).toBe(99);
    expect(client.currentSeq).toBe(6);
    client.stop();
  });

  it('rolls back rejected operations to the server state', async () => {
    const rejected = vi.fn();
    const client = makeClient({ onRejected: rejected });
    await client.start();
    const s = sockets[0]!;
    s.open();
    s.receive(welcome(5));
    client.submit([moveOp(client, 42)]);
    await vi.advanceTimersByTimeAsync(100);
    const ops = s.last('ops')!;
    s.receive({ t: 'ack', batchId: ops.batchId, results: [{ opId: ops.ops[0]!.opId, status: 'rejected', seq: null, reason: 'nope' }] });
    expect(rejected).toHaveBeenCalled();
    expect(applied.at(-1)![0]!.x).toBe(0);
    client.stop();
  });

  it('persists ops while offline and resends them after reconnecting', async () => {
    const storage = memoryStorage();
    const client = makeClient({ storage });
    await client.start();
    const s1 = sockets[0]!;
    s1.open();
    s1.receive(welcome(5));
    s1.close(1006, 'network');
    expect(client.currentStatus.connection).toBe('reconnecting');
    client.submit([moveOp(client, 7), moveOp(client, 8)]);
    await vi.advanceTimersByTimeAsync(10);
    expect(storage.data.get('b1')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    const s2 = sockets[1]!;
    s2.open();
    s2.receive(welcome(5));
    expect(client.currentStatus.save).toBe('syncing');
    await vi.advanceTimersByTimeAsync(10);
    const ops = s2.last('ops')!;
    expect(ops.ops.map((o) => o.type)).toEqual(['MOVE_ELEMENT', 'MOVE_ELEMENT']);
    s2.receive({ t: 'ack', batchId: ops.batchId, results: ops.ops.map((o, i) => ({ opId: o.opId, status: 'applied' as const, seq: 6 + i })) });
    expect(storage.data.get('b1')).toHaveLength(0);
    expect(client.currentStatus.save).toBe('saved');
    client.stop();
  });

  it('restores persisted offline ops on start and applies them locally', async () => {
    const storage = memoryStorage();
    const seed = new CollabClient({
      boardId: 'b1',
      clientId: 'c1',
      url: 'ws://x',
      canEdit: true,
      initialSeq: 5,
      initialElements: [base],
      createSocket: () => new FakeSocket(),
      onElements: () => undefined,
    });
    const op: Operation = { ...seed.nextMeta(1), type: 'MOVE_ELEMENT', elementId: 'r1', x: 300, y: 300 };
    await storage.savePending('b1', [op]);
    const client = makeClient({ storage });
    await client.start();
    expect(applied.at(-1)![0]!.x).toBe(300);
    expect(client.pendingCount).toBe(1);
    client.stop();
  });

  it('requests a resync when the server cannot replay missed changes', async () => {
    const onResync = vi.fn();
    const client = makeClient({ onResync });
    await client.start();
    sockets[0]!.open();
    sockets[0]!.receive(welcome(900, null));
    expect(onResync).toHaveBeenCalledWith('gap');
    client.stop();
  });

  it('falls back to HTTP when the socket is down', async () => {
    const http = {
      postOperations: vi.fn(async (_board: string, body: { ops: Operation[] }) => {
        const map = new Map([[base.id, base]]);
        const changes = body.ops.map((op, i) => {
          const res = applyOperation((id) => map.get(id), op);
          return { seq: 6 + i, opId: op.opId, clientId: 'c1', userId: 'u1', type: op.type, elements: res.elements };
        });
        return { results: body.ops.map((o, i) => ({ opId: o.opId, status: 'applied' as const, seq: 6 + i })), changes, seq: 6 + body.ops.length };
      }),
      getChanges: vi.fn(),
    };
    const client = makeClient({ http });
    await client.start();
    sockets[0]!.close(1006, 'down');
    client.submit([moveOp(client, 11)]);
    await vi.advanceTimersByTimeAsync(200);
    expect(http.postOperations).toHaveBeenCalled();
    expect(client.pendingCount).toBe(0);
    expect(client.currentSeq).toBe(6);
    client.stop();
  });

  it('tracks peers and ignores its own presence', async () => {
    const onPeers = vi.fn();
    const client = makeClient({ onPeers });
    await client.start();
    const s = sockets[0]!;
    s.open();
    s.receive(welcome(5));
    const peer = { clientId: 'c2', user, role: 'EDITOR' as const, state: { cursor: { x: 1, y: 2 }, selectedIds: [], tool: 'selection', viewport: null, editingId: null, active: false }, lastSeen: 1 };
    s.receive({ t: 'presence', peer });
    expect(onPeers).toHaveBeenLastCalledWith([peer]);
    s.receive({ t: 'peer-left', clientId: 'c2' });
    expect(onPeers).toHaveBeenLastCalledWith([]);
    client.updatePresence({ cursor: { x: 5, y: 5 } });
    await vi.advanceTimersByTimeAsync(100);
    expect(s.last('presence')?.state.cursor).toEqual({ x: 5, y: 5 });
    client.stop();
  });

  it('never sends operations in view-only mode', async () => {
    const client = makeClient({ canEdit: false });
    await client.start();
    const s = sockets[0]!;
    s.open();
    s.receive(welcome(5));
    client.submit([moveOp(client, 1)]);
    await vi.advanceTimersByTimeAsync(200);
    expect(s.last('ops')).toBeUndefined();
    client.stop();
  });
});
