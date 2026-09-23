import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  CLOSE_CODES,
  clientMessageSchema,
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
  WS_PATH,
  type ClientMessage,
  type PeerPresence,
  type PresenceState,
  type PresenceUser,
  type ServerMessage,
} from '@inkflow/collaboration';
import type { SceneElement } from '@inkflow/elements';
import { boardRoleAtLeast, colorForId, type BoardRole } from '@inkflow/shared';
import { AccessService } from '../access/access.service';
import { extractAccessToken } from '../auth/auth.guard';
import { TokensService } from '../auth/tokens.service';
import { AppConfig } from '../config/app-config';
import { AppError } from '../common/errors';
import { parseCookieHeader } from '../common/cookies';
import { OperationsService } from '../operations/operations.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PRESENCE_STATE, PresenceService } from './presence.service';
import { RealtimeService, type BusEnvelope } from './realtime.service';
import { TokenBucket } from './token-bucket';

/** Largest accepted client message. */
export const MAX_WS_PAYLOAD_BYTES = 5 * 1024 * 1024;
/** Sockets without any traffic for this long are closed. */
export const IDLE_TIMEOUT_MS = 45_000;
const HELLO_TIMEOUT_MS = 10_000;
/** Periodic re-validation of session and role (in addition to event-driven re-checks). */
const REVALIDATE_INTERVAL_MS = 60_000;
const MAX_QUEUED_BEFORE_WELCOME = 2_000;
const MAX_BUFFERED_BYTES = 32 * 1024 * 1024;
const BUCKET_CAPACITY = 300;
const BUCKET_REFILL_PER_SECOND = 150;
const MAX_RATE_VIOLATIONS = 500;

const GUEST_NAMES = [
  'Otter',
  'Falcon',
  'Lynx',
  'Heron',
  'Panda',
  'Koala',
  'Fox',
  'Orca',
  'Ibis',
  'Yak',
  'Gecko',
  'Moose',
];

interface Connection {
  id: string;
  ws: WebSocket;
  boardId: string;
  userId: string | null;
  sessionId: string | null;
  shareToken: string | null;
  role: BoardRole;
  user: PresenceUser;
  clientId: string | null;
  state: PresenceState;
  ready: boolean;
  queue: ServerMessage[];
  queueOverflow: boolean;
  /** Client messages received after hello but before the welcome was sent. */
  inbound: ClientMessage[];
  lastActivity: number;
  lastValidated: number;
  bucket: TokenBucket;
  violations: number;
  lastRateError: number;
  opsChain: Promise<void>;
  helloTimer: NodeJS.Timeout | null;
  closed: boolean;
}

interface Room {
  connections: Set<Connection>;
  unsubscribe: (() => Promise<void>) | null;
  subscribing: Promise<void> | null;
}

function guestIdentity(): PresenceUser {
  const id = `guest-${randomUUID()}`;
  const animal = GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)]!;
  return { id, name: `Guest ${animal}`, avatarUrl: null, color: colorForId(id), anonymous: true };
}

/**
 * Real-time collaboration over `ws` attached to Nest's HTTP server (noServer mode, `/api/ws`).
 * See docs/API_CONTRACT.md → "WebSocket" for the protocol.
 */
@Injectable()
export class CollaborationGateway implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(CollaborationGateway.name);
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
    clientTracking: false,
  });
  private readonly connections = new Set<Connection>();
  private readonly rooms = new Map<string, Room>();
  private server: Server | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) =>
    this.handleUpgrade(req, socket, head);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: AppConfig,
    private readonly tokens: TokensService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
    private readonly operations: OperationsService,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter?.getHttpServer() as Server | undefined;
    if (!server) {
      this.logger.warn('No HTTP server available; WebSocket collaboration is disabled');
      return;
    }
    this.server = server;
    server.on('upgrade', this.onUpgrade);
    this.heartbeat = setInterval(() => this.tick(), HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  /** Number of open collaboration sockets on this instance. */
  get connectionCount(): number {
    return this.connections.size;
  }

  // ───────────────────────────── connection setup ─────────────────────────────

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== WS_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (this.shuttingDown) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (this.config.isProduction) {
      const origin = req.headers.origin;
      if (!origin || origin.replace(/\/+$/, '') !== this.config.webOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.onConnection(ws, req, url).catch((err: Error) => {
        this.logger.error(`WebSocket setup failed: ${err.message}`);
        this.closeSocket(ws, CLOSE_CODES.GOING_AWAY, 'internal error');
      });
    });
  }

  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
      ws.close(code, reason.slice(0, 120));
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage, url: URL): Promise<void> {
    // Buffer messages that arrive while the connection is being authenticated.
    const early: RawData[] = [];
    const earlyListener = (data: RawData) => early.push(data);
    ws.on('message', earlyListener);
    ws.on('error', () => undefined);

    const boardId = url.searchParams.get('boardId') ?? '';
    const shareToken = url.searchParams.get('st');
    const cookies = parseCookieHeader(req.headers.cookie);
    const extracted = extractAccessToken({ headers: req.headers, cookies } as never);
    let userId: string | null = null;
    let sessionId: string | null = null;
    if (extracted) {
      const result = this.tokens.verifyAccessToken(extracted.token);
      if (result.status !== 'valid' || (await this.tokens.isSessionRevoked(result.claims.sid))) {
        this.closeSocket(
          ws,
          CLOSE_CODES.UNAUTHORIZED,
          result.status === 'expired' ? 'session expired' : 'unauthorized',
        );
        return;
      }
      userId = result.claims.sub;
      sessionId = result.claims.sid;
    }
    if (!userId && !shareToken) {
      this.closeSocket(ws, CLOSE_CODES.UNAUTHORIZED, 'authentication required');
      return;
    }
    const access = await this.access.getBoardAccess(boardId, { userId, shareToken });
    if (!access) {
      this.closeSocket(ws, CLOSE_CODES.NOT_FOUND, 'board not found');
      return;
    }
    let user: PresenceUser;
    if (userId) {
      const row = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, avatarUrl: true },
      });
      if (!row) {
        this.closeSocket(ws, CLOSE_CODES.UNAUTHORIZED, 'unknown user');
        return;
      }
      user = {
        id: row.id,
        name: row.name,
        avatarUrl: row.avatarUrl,
        color: colorForId(row.id),
        anonymous: false,
      };
    } else {
      user = guestIdentity();
    }

    const now = Date.now();
    const conn: Connection = {
      id: randomUUID(),
      ws,
      boardId: access.board.id,
      userId,
      sessionId,
      shareToken,
      role: access.role,
      user,
      clientId: null,
      state: { ...DEFAULT_PRESENCE_STATE },
      ready: false,
      queue: [],
      queueOverflow: false,
      inbound: [],
      lastActivity: now,
      lastValidated: now,
      bucket: new TokenBucket(BUCKET_CAPACITY, BUCKET_REFILL_PER_SECOND),
      violations: 0,
      lastRateError: 0,
      opsChain: Promise.resolve(),
      helloTimer: null,
      closed: false,
    };
    if (ws.readyState !== WebSocket.OPEN) return;
    this.connections.add(conn);
    conn.helloTimer = setTimeout(() => {
      if (!conn.clientId) this.closeConnection(conn, CLOSE_CODES.POLICY, 'hello expected');
    }, HELLO_TIMEOUT_MS);
    conn.helloTimer.unref();

    ws.off('message', earlyListener);
    ws.on('message', (data: RawData, isBinary: boolean) => this.onMessage(conn, data, isBinary));
    ws.on('close', () => void this.cleanup(conn));
    ws.on('pong', () => {
      conn.lastActivity = Date.now();
    });
    for (const data of early) this.onMessage(conn, data, false);
  }

  // ───────────────────────────── messages ─────────────────────────────

  private send(conn: Connection, msg: ServerMessage): void {
    if (conn.closed || conn.ws.readyState !== WebSocket.OPEN) return;
    if (conn.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.logger.warn(`Terminating slow WebSocket consumer on board ${conn.boardId}`);
      conn.ws.terminate();
      return;
    }
    conn.ws.send(JSON.stringify(msg));
  }

  private sendError(conn: Connection, code: string, message: string, fatal = false): void {
    this.send(conn, { t: 'error', code, message, fatal });
  }

  private onMessage(conn: Connection, data: RawData, isBinary: boolean): void {
    if (conn.closed) return;
    conn.lastActivity = Date.now();
    if (!conn.bucket.take(1)) {
      conn.violations++;
      if (conn.violations > MAX_RATE_VIOLATIONS) {
        this.closeConnection(conn, CLOSE_CODES.RATE_LIMITED, 'rate limit exceeded');
        return;
      }
      if (Date.now() - conn.lastRateError > 1000) {
        conn.lastRateError = Date.now();
        this.sendError(conn, 'RATE_LIMITED', 'Too many messages; some were dropped');
      }
      return;
    }
    if (isBinary) {
      this.sendError(conn, 'BAD_MESSAGE', 'Binary messages are not supported');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.sendError(conn, 'BAD_MESSAGE', 'Messages must be JSON');
      return;
    }
    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      this.sendError(
        conn,
        'BAD_MESSAGE',
        `Invalid message${issue ? `: ${issue.path.join('.')} ${issue.message}` : ''}`,
      );
      return;
    }
    const msg = result.data as ClientMessage;
    if (msg.t === 'ping') {
      this.send(conn, { t: 'pong', ts: msg.ts });
      if (conn.ready) void this.storePresence(conn).catch(() => undefined);
      return;
    }
    if (msg.t === 'hello') {
      void this.onHello(conn, msg).catch((err: Error) => {
        this.logger.error(`hello failed: ${err.message}`);
        this.closeConnection(conn, CLOSE_CODES.GOING_AWAY, 'internal error');
      });
      return;
    }
    if (!conn.clientId) {
      this.sendError(conn, 'HELLO_REQUIRED', 'Send hello first', true);
      this.closeConnection(conn, CLOSE_CODES.POLICY, 'hello expected');
      return;
    }
    if (!conn.ready) {
      if (conn.inbound.length < 1000) conn.inbound.push(msg);
      return;
    }
    this.dispatch(conn, msg);
  }

  private dispatch(conn: Connection, msg: ClientMessage): void {
    switch (msg.t) {
      case 'ops':
        conn.opsChain = conn.opsChain
          .then(() => this.onOps(conn, msg.batchId, msg.ops as unknown[]))
          .catch(() => undefined);
        return;
      case 'transient':
        this.onTransient(conn, msg.elements as unknown as SceneElement[]);
        return;
      case 'presence':
        this.onPresence(conn, msg.state);
        return;
      case 'sync':
        void this.onSync(conn, msg.sinceSeq).catch((err: Error) =>
          this.sendError(conn, 'SYNC_FAILED', err.message),
        );
        return;
      default:
        return;
    }
  }

  private peerOf(conn: Connection): PeerPresence {
    return {
      clientId: conn.clientId!,
      user: conn.user,
      role: conn.role,
      state: conn.state,
      lastSeen: Date.now(),
    };
  }

  private async storePresence(conn: Connection): Promise<void> {
    if (!conn.clientId || conn.closed) return;
    await this.presence.put(conn.boardId, this.peerOf(conn));
  }

  private async onHello(
    conn: Connection,
    msg: Extract<ClientMessage, { t: 'hello' }>,
  ): Promise<void> {
    if (conn.clientId) {
      this.sendError(conn, 'BAD_MESSAGE', 'hello was already received');
      return;
    }
    if (msg.protocol !== PROTOCOL_VERSION) {
      this.sendError(conn, 'PROTOCOL_MISMATCH', `Server speaks protocol ${PROTOCOL_VERSION}`, true);
      this.closeConnection(conn, CLOSE_CODES.PROTOCOL_MISMATCH, 'protocol mismatch');
      return;
    }
    if (msg.boardId !== conn.boardId) {
      this.closeConnection(conn, CLOSE_CODES.POLICY, 'boardId mismatch');
      return;
    }
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    conn.clientId = msg.clientId;

    // A reconnect with the same client id replaces the previous socket.
    const room = this.rooms.get(conn.boardId);
    for (const other of room?.connections ?? []) {
      if (other !== conn && other.clientId === msg.clientId)
        this.closeConnection(other, CLOSE_CODES.NORMAL, 'replaced by a new connection');
    }

    const access = await this.access.getBoardAccess(conn.boardId, {
      userId: conn.userId,
      shareToken: conn.shareToken,
    });
    if (!access) {
      this.closeConnection(conn, CLOSE_CODES.NOT_FOUND, 'board not found');
      return;
    }
    conn.role = access.role;
    await this.joinRoom(conn);
    if (conn.closed) return;

    const [peers, replay] = await Promise.all([
      this.presence.list(conn.boardId),
      this.operations.changesSince(conn.boardId, msg.lastSeq),
    ]);
    await this.storePresence(conn);
    if (conn.closed) return;
    this.send(conn, {
      t: 'welcome',
      protocol: PROTOCOL_VERSION,
      clientId: msg.clientId,
      role: conn.role,
      user: conn.user,
      seq: replay.seq,
      peers: peers.filter((p) => p.clientId !== msg.clientId),
      missed: replay.changes,
    });
    conn.ready = true;
    const queued = conn.queue;
    conn.queue = [];
    if (conn.queueOverflow) {
      this.send(conn, { t: 'resync', reason: 'too many changes while connecting' });
    } else {
      for (const m of queued) {
        if (m.t === 'changes') {
          const changes = m.changes.filter((c) => c.seq > replay.seq);
          if (changes.length > 0) this.send(conn, { t: 'changes', changes });
        } else {
          this.send(conn, m);
        }
      }
    }
    void this.realtime.publishMessage(
      conn.boardId,
      { t: 'presence', peer: this.peerOf(conn) },
      msg.clientId,
    );
    const inbound = conn.inbound;
    conn.inbound = [];
    for (const m of inbound) this.dispatch(conn, m);
  }

  private async onOps(conn: Connection, batchId: string, ops: unknown[]): Promise<void> {
    if (conn.closed) return;
    const access = await this.access.getBoardAccess(conn.boardId, {
      userId: conn.userId,
      shareToken: conn.shareToken,
    });
    if (!access) {
      this.closeConnection(conn, CLOSE_CODES.FORBIDDEN, 'access revoked');
      return;
    }
    conn.role = access.role;
    if (!boardRoleAtLeast(access.role, 'EDITOR')) {
      this.sendError(conn, 'FORBIDDEN', 'Viewers cannot edit this board');
      this.send(conn, {
        t: 'ack',
        batchId,
        results: ops.map((op, i) => ({
          opId:
            op && typeof op === 'object' && typeof (op as { opId?: unknown }).opId === 'string'
              ? (op as { opId: string }).opId
              : `invalid-${i}`,
          status: 'rejected' as const,
          seq: null,
          reason: 'FORBIDDEN',
        })),
      });
      return;
    }
    try {
      const result = await this.operations.applyBatch(
        conn.boardId,
        { userId: conn.userId },
        conn.clientId!,
        ops,
      );
      this.send(conn, { t: 'ack', batchId, results: result.results });
    } catch (err) {
      if (err instanceof AppError && err.getStatus() === 404) {
        this.closeConnection(conn, CLOSE_CODES.BOARD_DELETED, 'board deleted');
        return;
      }
      this.logger.error(
        `ops batch ${batchId} failed on board ${conn.boardId}: ${(err as Error).message}`,
      );
      this.sendError(conn, 'OPS_FAILED', `Batch ${batchId} could not be applied; retry later`);
    }
  }

  private onTransient(conn: Connection, elements: SceneElement[]): void {
    if (!boardRoleAtLeast(conn.role, 'EDITOR')) {
      this.sendError(conn, 'FORBIDDEN', 'Viewers cannot edit this board');
      return;
    }
    const valid = elements.filter(
      (el) =>
        el &&
        typeof el === 'object' &&
        typeof el.id === 'string' &&
        el.id.length > 0 &&
        el.id.length <= 128,
    );
    if (valid.length === 0) return;
    void this.realtime.publishMessage(
      conn.boardId,
      { t: 'transient', clientId: conn.clientId!, elements: valid },
      conn.clientId!,
    );
  }

  private onPresence(conn: Connection, state: Partial<PresenceState>): void {
    conn.state = { ...conn.state, ...state };
    const peer = this.peerOf(conn);
    void this.presence.put(conn.boardId, peer).catch(() => undefined);
    void this.realtime.publishMessage(conn.boardId, { t: 'presence', peer }, conn.clientId!);
  }

  private async onSync(conn: Connection, sinceSeq: number): Promise<void> {
    const replay = await this.operations.changesSince(conn.boardId, sinceSeq);
    if (replay.changes === null) this.send(conn, { t: 'resync', reason: 'gap too large' });
    else if (replay.changes.length > 0) this.send(conn, { t: 'changes', changes: replay.changes });
  }

  // ───────────────────────────── rooms & bus ─────────────────────────────

  private async joinRoom(conn: Connection): Promise<void> {
    let room = this.rooms.get(conn.boardId);
    if (!room) {
      room = { connections: new Set(), unsubscribe: null, subscribing: null };
      this.rooms.set(conn.boardId, room);
    }
    room.connections.add(conn);
    if (!room.unsubscribe) {
      const current = room;
      current.subscribing ??= this.realtime
        .subscribe(conn.boardId, (envelope) => this.onBus(conn.boardId, envelope))
        .then((unsubscribe) => {
          current.unsubscribe = unsubscribe;
        })
        .finally(() => {
          current.subscribing = null;
        });
      await current.subscribing;
    }
  }

  private onBus(boardId: string, envelope: BusEnvelope): void {
    const room = this.rooms.get(boardId);
    if (!room) return;
    if (envelope.control === 'board-deleted') {
      for (const conn of [...room.connections]) {
        if (envelope.msg) this.send(conn, envelope.msg);
        this.closeConnection(conn, CLOSE_CODES.BOARD_DELETED, 'board deleted');
      }
      return;
    }
    if (envelope.control === 'recheck-access') {
      void this.recheckRoom(boardId).then(() => this.deliver(boardId, envelope));
      return;
    }
    this.deliver(boardId, envelope);
  }

  private deliver(boardId: string, envelope: BusEnvelope): void {
    const room = this.rooms.get(boardId);
    if (!room || !envelope.msg) return;
    const msg = envelope.msg;
    for (const conn of room.connections) {
      if (conn.closed) continue;
      if (envelope.exclude && conn.clientId === envelope.exclude) continue;
      if (!conn.ready) {
        if (conn.queue.length >= MAX_QUEUED_BEFORE_WELCOME) conn.queueOverflow = true;
        else conn.queue.push(msg);
        continue;
      }
      this.send(conn, msg);
    }
  }

  /** Re-resolves the role of every socket on a board; sockets that lost access are closed. */
  private async recheckRoom(boardId: string): Promise<void> {
    const room = this.rooms.get(boardId);
    if (!room) return;
    await Promise.all([...room.connections].map((conn) => this.revalidate(conn)));
  }

  private async revalidate(conn: Connection): Promise<void> {
    if (conn.closed) return;
    conn.lastValidated = Date.now();
    if (conn.sessionId && (await this.tokens.isSessionRevoked(conn.sessionId))) {
      this.closeConnection(conn, CLOSE_CODES.UNAUTHORIZED, 'session revoked');
      return;
    }
    const access = await this.access.getBoardAccess(conn.boardId, {
      userId: conn.userId,
      shareToken: conn.shareToken,
    });
    if (!access) {
      this.closeConnection(conn, CLOSE_CODES.FORBIDDEN, 'access revoked');
      return;
    }
    if (access.role !== conn.role) {
      conn.role = access.role;
      if (conn.ready) {
        void this.storePresence(conn).catch(() => undefined);
        void this.realtime.publishMessage(
          conn.boardId,
          { t: 'presence', peer: this.peerOf(conn) },
          conn.clientId ?? undefined,
        );
      }
    }
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  private closeConnection(conn: Connection, code: number, reason: string): void {
    this.closeSocket(conn.ws, code, reason);
    void this.cleanup(conn);
  }

  private async cleanup(conn: Connection): Promise<void> {
    if (conn.closed) return;
    conn.closed = true;
    if (conn.helloTimer) clearTimeout(conn.helloTimer);
    this.connections.delete(conn);
    const room = this.rooms.get(conn.boardId);
    if (room) {
      room.connections.delete(conn);
      if (room.connections.size === 0) {
        this.rooms.delete(conn.boardId);
        await room.subscribing?.catch(() => undefined);
        await room.unsubscribe?.();
      }
    }
    if (conn.clientId) {
      // Another socket of the same client (reconnect) keeps its presence entry.
      const replaced = [...this.connections].some(
        (c) => c.boardId === conn.boardId && c.clientId === conn.clientId,
      );
      if (!replaced) {
        await this.presence.remove(conn.boardId, conn.clientId).catch(() => undefined);
        await this.realtime.publishMessage(conn.boardId, {
          t: 'peer-left',
          clientId: conn.clientId,
        });
      }
    }
  }

  private tick(): void {
    const now = Date.now();
    for (const conn of [...this.connections]) {
      if (now - conn.lastActivity > IDLE_TIMEOUT_MS) {
        this.closeConnection(conn, CLOSE_CODES.GOING_AWAY, 'idle timeout');
        continue;
      }
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.ping();
      if (now - conn.lastValidated > REVALIDATE_INTERVAL_MS)
        void this.revalidate(conn).catch(() => undefined);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.server?.off('upgrade', this.onUpgrade);
    const conns = [...this.connections];
    for (const conn of conns)
      this.closeSocket(conn.ws, CLOSE_CODES.GOING_AWAY, 'server shutting down');
    await Promise.allSettled(conns.map((conn) => this.cleanup(conn)));
    // Give clients a moment to complete the close handshake, then force-close stragglers.
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const conn of conns) if (conn.ws.readyState !== WebSocket.CLOSED) conn.ws.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
