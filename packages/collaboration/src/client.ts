import type { SceneElement } from '@inkflow/elements';
import { applyOperation, operationTargets, type Operation } from '@inkflow/scene';
import { generateId, throttle, type BoardRole, type Throttled } from '@inkflow/shared';
import {
  CLOSE_CODES,
  HEARTBEAT_INTERVAL_MS,
  MAX_OPS_PER_BATCH,
  OPS_FLUSH_INTERVAL_MS,
  PRESENCE_THROTTLE_MS,
  PROTOCOL_VERSION,
  TRANSIENT_THROTTLE_MS,
  decodeServerMessage,
  encodeMessage,
  type BoardEvent,
  type ClientMessage,
  type OpResult,
  type PeerPresence,
  type PresenceState,
  type PresenceUser,
  type ServerChange,
} from './protocol';

export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'offline';
export type SaveState = 'saved' | 'saving' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  connection: ConnectionState;
  save: SaveState;
  pendingOps: number;
  lastSavedAt: number | null;
  /** Last server-side error message, if any. */
  error: string | null;
}

/** Durable local storage for unsent operations (IndexedDB in browsers). */
export interface CollabStorage {
  loadPending(boardId: string): Promise<Operation[]>;
  savePending(boardId: string, ops: readonly Operation[]): Promise<void>;
}

/** HTTP fallback used when the WebSocket is unavailable. */
export interface CollabHttpTransport {
  postOperations(
    boardId: string,
    body: { clientId: string; batchId: string; ops: Operation[] },
  ): Promise<{ results: OpResult[]; changes: ServerChange[]; seq: number }>;
  getChanges(boardId: string, since: number): Promise<{ seq: number; changes: ServerChange[] | null }>;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface CollabClientOptions {
  boardId: string;
  clientId: string;
  /** Absolute ws(s) URL including query (boardId, share token). */
  url: string;
  canEdit: boolean;
  /** Server seq of the loaded document. */
  initialSeq: number;
  /** Element states of the loaded document (authoritative base for rebasing). */
  initialElements: readonly SceneElement[];
  storage?: CollabStorage;
  http?: CollabHttpTransport;
  createSocket?: (url: string) => WebSocketLike;
  /** Apply authoritative (rebased) element states to the editor. */
  onElements(elements: SceneElement[]): void;
  onTransient?(clientId: string, elements: SceneElement[]): void;
  onPeers?(peers: PeerPresence[]): void;
  onStatus?(status: SyncStatus): void;
  onEvent?(event: BoardEvent): void;
  /** The document must be reloaded over HTTP (gap too large, version restored). */
  onResync?(reason: string): void;
  /** Operations rejected by the server (their effects were rolled back locally). */
  onRejected?(results: OpResult[]): void;
  onWelcome?(info: { role: BoardRole; user: PresenceUser }): void;
  onFatal?(code: number, message: string): void;
}

const OPEN = 1;
const MAX_BACKOFF_MS = 10_000;
const PONG_TIMEOUT_MS = 10_000;

/**
 * Real-time sync engine. Local operations are queued (and persisted for offline use), sent in
 * batches, and removed once the server applied them. Incoming authoritative element states are
 * rebased with the still-pending local operations, so local intent is never lost while the
 * document converges to the server's ordering (per-property last-writer-wins).
 */
export class CollabClient {
  private socket: WebSocketLike | null = null;
  private readonly server = new Map<string, SceneElement>();
  private pending: Operation[] = [];
  private inFlight: { batchId: string; opIds: Set<string>; viaHttp: boolean } | null = null;
  private seq: number;
  private readonly seenAbove = new Set<number>();
  private peers = new Map<string, PeerPresence>();
  private welcomed = false;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private clientSeq = 0;
  /** Whether the HTTP fallback succeeded recently while the socket is down. */
  private httpReachable = false;
  private status: SyncStatus = { connection: 'connecting', save: 'saved', pendingOps: 0, lastSavedAt: null, error: null };
  private readonly sendTransientThrottled: Throttled<[SceneElement[]]>;
  private readonly sendPresenceThrottled: Throttled<[]>;
  private presence: Partial<PresenceState> = {};
  private transientBuffer = new Map<string, SceneElement>();
  private readonly onOnline = () => this.reconnectNow();
  private readonly onOffline = () => this.socket?.close(CLOSE_CODES.GOING_AWAY, 'offline');

  constructor(private readonly options: CollabClientOptions) {
    this.seq = options.initialSeq;
    for (const el of options.initialElements) this.server.set(el.id, el);
    this.sendTransientThrottled = throttle(() => this.flushTransient(), TRANSIENT_THROTTLE_MS);
    this.sendPresenceThrottled = throttle(() => this.flushPresence(), PRESENCE_THROTTLE_MS);
  }

  get currentStatus(): SyncStatus {
    return this.status;
  }

  get currentSeq(): number {
    return this.seq;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Loads persisted offline operations, applies them locally and connects. */
  async start(): Promise<void> {
    if (this.options.storage) {
      try {
        const stored = await this.options.storage.loadPending(this.options.boardId);
        if (stored.length) {
          this.pending = [...stored, ...this.pending];
          this.clientSeq = Math.max(this.clientSeq, ...stored.map((o) => o.clientSeq));
          this.emitRebased(new Set(stored.flatMap(operationTargets)));
        }
      } catch (error) {
        console.warn('[inkflow] could not load offline changes', error);
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
    this.updateStatus();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
    this.sendTransientThrottled.cancel();
    this.sendPresenceThrottled.cancel();
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close(CLOSE_CODES.NORMAL, 'client stopped');
    }
  }

  /** Replaces the authoritative base (after a full HTTP reload). Pending ops are re-applied on top. */
  resetBase(elements: readonly SceneElement[], seq: number): void {
    this.server.clear();
    for (const el of elements) this.server.set(el.id, el);
    this.seq = seq;
    this.seenAbove.clear();
    if (this.pending.length) this.emitRebased(new Set(this.pending.flatMap(operationTargets)));
  }

  /** Creates operation metadata for the next local operation. */
  nextMeta(baseVersion: number | null) {
    this.clientSeq += 1;
    return {
      opId: generateId(),
      clientId: this.options.clientId,
      clientSeq: this.clientSeq,
      timestamp: Date.now(),
      baseVersion,
    };
  }

  /** Queues committed local operations for delivery. */
  submit(ops: readonly Operation[]): void {
    if (!this.options.canEdit || ops.length === 0) return;
    this.pending.push(...ops);
    this.persist();
    this.updateStatus();
    this.scheduleFlush();
  }

  sendTransient(elements: readonly SceneElement[]): void {
    if (!this.options.canEdit) return;
    for (const el of elements) this.transientBuffer.set(el.id, el);
    this.sendTransientThrottled(elements as SceneElement[]);
  }

  updatePresence(state: Partial<PresenceState>): void {
    this.presence = { ...this.presence, ...state };
    this.sendPresenceThrottled();
  }

  setCanEdit(canEdit: boolean): void {
    this.options.canEdit = canEdit;
  }

  // ───────────────────────────── connection ─────────────────────────────

  private connect() {
    if (this.stopped) return;
    const create = this.options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    this.setConnection(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let socket: WebSocketLike;
    try {
      socket = create(this.options.url);
    } catch (error) {
      console.warn('[inkflow] websocket failed to open', error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.welcomed = false;
    socket.onopen = () => {
      this.send({ t: 'hello', protocol: PROTOCOL_VERSION, boardId: this.options.boardId, clientId: this.options.clientId, lastSeq: this.seq });
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      const msg = decodeServerMessage(ev.data);
      if (msg) this.handleMessage(msg);
    };
    socket.onerror = () => {
      // Errors are followed by close; reconnection happens there.
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.welcomed = false;
      this.inFlight = this.inFlight?.viaHttp ? this.inFlight : null;
      this.stopHeartbeat();
      if (ev.code === CLOSE_CODES.UNAUTHORIZED || ev.code === CLOSE_CODES.FORBIDDEN || ev.code === CLOSE_CODES.NOT_FOUND || ev.code === CLOSE_CODES.BOARD_DELETED || ev.code === CLOSE_CODES.PROTOCOL_MISMATCH) {
        this.setConnection('offline');
        this.options.onFatal?.(ev.code, ev.reason || 'Connection closed by server');
        // Unauthorized may be a stale access token: retry after the app refreshes the session.
        if (ev.code === CLOSE_CODES.UNAUTHORIZED) this.scheduleReconnect();
        return;
      }
      this.setConnection(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'reconnecting');
      this.scheduleReconnect();
      // Keep saving through HTTP while the socket is down.
      this.scheduleFlush();
    };
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private reconnectNow() {
    if (this.stopped) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.socket) {
      this.attempt = 0;
      this.connect();
    }
  }

  private send(msg: ClientMessage): boolean {
    const s = this.socket;
    if (!s || s.readyState !== OPEN) return false;
    try {
      s.send(encodeMessage(msg));
      return true;
    } catch {
      return false;
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.send({ t: 'ping', ts: Date.now() })) return;
      if (this.pongTimer) return;
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        // No pong: the connection is dead even if the browser hasn't noticed.
        this.socket?.close(CLOSE_CODES.GOING_AWAY, 'heartbeat timeout');
      }, PONG_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.heartbeatTimer = null;
    this.pongTimer = null;
  }

  private clearTimers() {
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.reconnectTimer = null;
    this.flushTimer = null;
  }

  // ───────────────────────────── messages ─────────────────────────────

  private handleMessage(msg: NonNullable<ReturnType<typeof decodeServerMessage>>) {
    switch (msg.t) {
      case 'welcome': {
        this.welcomed = true;
        this.httpReachable = false;
        this.attempt = 0;
        this.setConnection('online');
        this.startHeartbeat();
        this.options.onWelcome?.({ role: msg.role, user: msg.user });
        this.peers = new Map(msg.peers.filter((p) => p.clientId !== this.options.clientId).map((p) => [p.clientId, p]));
        this.options.onPeers?.([...this.peers.values()]);
        if (msg.missed === null) {
          this.options.onResync?.('gap');
        } else if (msg.missed.length) {
          this.applyChanges(msg.missed);
        }
        this.seq = Math.max(this.seq, msg.seq);
        this.seenAbove.clear();
        this.flushPresence();
        if (this.pending.length) this.setSave('syncing');
        this.scheduleFlush(0);
        return;
      }
      case 'changes':
        this.applyChanges(msg.changes);
        return;
      case 'ack':
        this.handleAck(msg.batchId, msg.results);
        return;
      case 'transient':
        if (msg.clientId !== this.options.clientId) this.options.onTransient?.(msg.clientId, msg.elements);
        return;
      case 'presence':
        if (msg.peer.clientId === this.options.clientId) return;
        this.peers.set(msg.peer.clientId, msg.peer);
        this.options.onPeers?.([...this.peers.values()]);
        return;
      case 'peer-left':
        if (this.peers.delete(msg.clientId)) this.options.onPeers?.([...this.peers.values()]);
        return;
      case 'event':
        this.options.onEvent?.(msg.event);
        return;
      case 'resync':
        this.options.onResync?.(msg.reason);
        return;
      case 'error':
        this.status = { ...this.status, error: msg.message };
        this.updateStatus();
        if (msg.fatal) this.options.onFatal?.(0, msg.message);
        return;
      case 'pong':
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = null;
        return;
    }
  }

  private advanceSeq(seq: number) {
    if (seq <= this.seq) return;
    this.seenAbove.add(seq);
    while (this.seenAbove.has(this.seq + 1)) {
      this.seenAbove.delete(this.seq + 1);
      this.seq += 1;
    }
    // A snapshot-style change may jump ahead (e.g. missed replay): accept if nothing is buffered.
    if (this.seenAbove.size > 200) {
      this.seq = Math.max(...this.seenAbove);
      this.seenAbove.clear();
    }
  }

  private applyChanges(changes: readonly ServerChange[]) {
    const touched = new Set<string>();
    for (const change of changes) {
      for (const el of change.elements) {
        const current = this.server.get(el.id);
        if (!current || el.version >= current.version) {
          this.server.set(el.id, el);
          touched.add(el.id);
        }
      }
      this.advanceSeq(change.seq);
    }
    if (touched.size) this.emitRebased(touched);
  }

  /** Recomputes local states (server + pending) for the given element ids and emits them. */
  private emitRebased(ids: ReadonlySet<string>) {
    const pendingByTarget = new Map<string, Operation[]>();
    for (const op of this.pending) {
      for (const id of operationTargets(op)) {
        if (!ids.has(id)) continue;
        const list = pendingByTarget.get(id);
        if (list) list.push(op);
        else pendingByTarget.set(id, [op]);
      }
    }
    const out: SceneElement[] = [];
    for (const id of ids) {
      let el = this.server.get(id);
      const ops = pendingByTarget.get(id);
      if (ops) {
        const local = new Map<string, SceneElement>();
        if (el) local.set(id, el);
        for (const op of ops) {
          const res = applyOperation((x) => local.get(x) ?? this.server.get(x), op, { validate: false });
          for (const r of res.elements) if (r.id === id) local.set(id, r);
        }
        el = local.get(id);
      }
      if (el) out.push(el);
    }
    if (out.length) this.options.onElements(out);
  }

  private handleAck(batchId: string, results: readonly OpResult[]) {
    if (!this.inFlight || this.inFlight.batchId !== batchId) return;
    this.inFlight = null;
    this.processResults(results);
  }

  private processResults(results: readonly OpResult[]) {
    const done = new Set<string>();
    const rejected: OpResult[] = [];
    for (const r of results) {
      done.add(r.opId);
      if (r.status === 'rejected') rejected.push(r);
    }
    const rejectedOps = this.pending.filter((op) => rejected.some((r) => r.opId === op.opId));
    this.pending = this.pending.filter((op) => !done.has(op.opId));
    this.persist();
    if (rejectedOps.length) {
      // Roll rejected intent back to the authoritative state.
      this.emitRebased(new Set(rejectedOps.flatMap(operationTargets)));
      this.options.onRejected?.(rejected);
    }
    this.status = { ...this.status, lastSavedAt: Date.now(), error: rejected.length ? (rejected[0]!.reason ?? 'Change rejected') : null };
    this.updateStatus();
    if (this.pending.length) this.scheduleFlush(0);
  }

  // ───────────────────────────── flushing ─────────────────────────────

  private scheduleFlush(delay = OPS_FLUSH_INTERVAL_MS) {
    if (this.stopped || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  private async flush() {
    if (this.inFlight || this.pending.length === 0 || !this.options.canEdit) return;
    const batch = this.pending.slice(0, MAX_OPS_PER_BATCH);
    const batchId = generateId();
    if (this.socket && this.welcomed) {
      this.inFlight = { batchId, opIds: new Set(batch.map((o) => o.opId)), viaHttp: false };
      if (!this.send({ t: 'ops', batchId, ops: batch })) this.inFlight = null;
      this.updateStatus();
      return;
    }
    const http = this.options.http;
    if (!http || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      this.updateStatus();
      return;
    }
    this.inFlight = { batchId, opIds: new Set(batch.map((o) => o.opId)), viaHttp: true };
    this.updateStatus();
    try {
      const res = await http.postOperations(this.options.boardId, { clientId: this.options.clientId, batchId, ops: batch });
      this.inFlight = null;
      this.httpReachable = true;
      this.applyChanges(res.changes);
      this.processResults(res.results);
    } catch (error) {
      this.inFlight = null;
      this.httpReachable = false;
      this.status = { ...this.status, error: error instanceof Error ? error.message : 'Save failed' };
      this.updateStatus();
      // Retry later; the ops stay queued (and persisted).
      setTimeout(() => this.scheduleFlush(), 3000);
    }
  }

  private flushTransient() {
    if (!this.welcomed || this.transientBuffer.size === 0) return;
    const elements = [...this.transientBuffer.values()];
    this.transientBuffer.clear();
    this.send({ t: 'transient', elements });
  }

  private flushPresence() {
    if (!this.welcomed) return;
    this.send({ t: 'presence', state: this.presence });
  }

  private persist() {
    const storage = this.options.storage;
    if (!storage) return;
    storage.savePending(this.options.boardId, this.pending).catch((error) => console.warn('[inkflow] could not persist offline changes', error));
  }

  // ───────────────────────────── status ─────────────────────────────

  private setConnection(connection: ConnectionState) {
    this.status = { ...this.status, connection };
    this.updateStatus();
  }

  private setSave(save: SaveState) {
    this.status = { ...this.status, save };
    this.options.onStatus?.(this.status);
  }

  private updateStatus() {
    const pendingOps = this.pending.length;
    const online = this.status.connection === 'online' || this.httpReachable;
    let save: SaveState;
    if (!online) save = 'offline';
    else if (pendingOps === 0) save = 'saved';
    else if (this.status.save === 'syncing' || this.status.save === 'offline') save = 'syncing';
    else save = 'saving';
    this.status = { ...this.status, pendingOps, save };
    this.options.onStatus?.(this.status);
  }
}
