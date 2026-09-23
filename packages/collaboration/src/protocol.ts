import type { SceneElement } from '@inkflow/elements';
import { operationSchema, type Operation, type OperationType } from '@inkflow/scene';
import type { BoardRole } from '@inkflow/shared';
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
/** WebSocket endpoint path (proxied under the API origin). */
export const WS_PATH = '/api/ws';

/** Max operations per `ops` batch sent by a client. */
export const MAX_OPS_PER_BATCH = 500;
/** Client flush interval for persistent operations. */
export const OPS_FLUSH_INTERVAL_MS = 80;
/** Throttle for transient (live drag preview) updates. */
export const TRANSIENT_THROTTLE_MS = 50;
/** Throttle for cursor/presence updates. */
export const PRESENCE_THROTTLE_MS = 40;
/** Presence entries expire when a client stops heartbeating. */
export const PRESENCE_TTL_SECONDS = 30;
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** Maximum number of missed changes replayed on reconnect before requiring a full resync. */
export const MAX_REPLAY_ELEMENTS = 5_000;

export interface PresenceUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  /** True for anonymous share-link visitors. */
  anonymous: boolean;
}

export interface PresenceState {
  cursor: { x: number; y: number } | null;
  selectedIds: string[];
  tool: string;
  /** Visible world rectangle, used for "follow" and the collaborator minimap. */
  viewport: { x: number; y: number; width: number; height: number } | null;
  /** Element currently being text-edited by this peer. */
  editingId: string | null;
  /** Pointer is pressed (drawing/dragging) — rendered as an active cursor. */
  active: boolean;
}

export interface PeerPresence {
  clientId: string;
  user: PresenceUser;
  role: BoardRole;
  state: PresenceState;
  lastSeen: number;
}

/** A committed server change: the result of one operation, with authoritative element states. */
export interface ServerChange {
  seq: number;
  opId: string;
  clientId: string;
  userId: string | null;
  type: OperationType;
  /** Element states after the operation was applied (versions are server-assigned). */
  elements: SceneElement[];
}

export type OpStatus = 'applied' | 'duplicate' | 'rejected';

export interface OpResult {
  opId: string;
  status: OpStatus;
  seq: number | null;
  reason?: string;
}

export type BoardEvent =
  | { kind: 'comments-changed'; commentId: string | null }
  | { kind: 'board-renamed'; title: string }
  | { kind: 'board-deleted' }
  | { kind: 'permissions-changed' }
  | { kind: 'version-restored'; versionId: string };

// ───────────────────────────── client → server ─────────────────────────────

export type ClientMessage =
  | { t: 'hello'; protocol: number; boardId: string; clientId: string; lastSeq: number }
  | { t: 'ops'; batchId: string; ops: Operation[] }
  | { t: 'transient'; elements: SceneElement[] }
  | { t: 'presence'; state: Partial<PresenceState> }
  | { t: 'sync'; sinceSeq: number }
  | { t: 'ping'; ts: number };

const id = z.string().min(1).max(128);

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    protocol: z.number().int(),
    boardId: id,
    clientId: id,
    lastSeq: z.number().int().min(0),
  }),
  z.object({ t: z.literal('ops'), batchId: id, ops: z.array(operationSchema).min(1).max(MAX_OPS_PER_BATCH) }),
  z.object({ t: z.literal('transient'), elements: z.array(z.record(z.string(), z.unknown())).max(2000) }),
  z.object({
    t: z.literal('presence'),
    state: z
      .object({
        cursor: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
        selectedIds: z.array(id).max(5000),
        tool: z.string().max(40),
        viewport: z
          .object({
            x: z.number().finite(),
            y: z.number().finite(),
            width: z.number().finite(),
            height: z.number().finite(),
          })
          .nullable(),
        editingId: id.nullable(),
        active: z.boolean(),
      })
      .partial(),
  }),
  z.object({ t: z.literal('sync'), sinceSeq: z.number().int().min(0) }),
  z.object({ t: z.literal('ping'), ts: z.number() }),
]);

// ───────────────────────────── server → client ─────────────────────────────

export type ServerMessage =
  | {
      t: 'welcome';
      protocol: number;
      clientId: string;
      role: BoardRole;
      user: PresenceUser;
      /** Latest committed sequence number. */
      seq: number;
      peers: PeerPresence[];
      /**
       * Changes the client missed since its `lastSeq` (current element states). Null when the gap
       * is too large and the client must reload the document over HTTP.
       */
      missed: ServerChange[] | null;
    }
  | { t: 'changes'; changes: ServerChange[] }
  | { t: 'ack'; batchId: string; results: OpResult[] }
  | { t: 'transient'; clientId: string; elements: SceneElement[] }
  | { t: 'presence'; peer: PeerPresence }
  | { t: 'peer-left'; clientId: string }
  | { t: 'event'; event: BoardEvent }
  | { t: 'resync'; reason: string }
  | { t: 'error'; code: string; message: string; fatal: boolean }
  | { t: 'pong'; ts: number };

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function decodeServerMessage(data: string): ServerMessage | null {
  try {
    const parsed = JSON.parse(data) as ServerMessage;
    return parsed && typeof parsed === 'object' && typeof parsed.t === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** WebSocket close codes used by the server. */
export const CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  POLICY: 1008,
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
  PROTOCOL_MISMATCH: 4426,
  RATE_LIMITED: 4429,
  BOARD_DELETED: 4410,
} as const;

/** Redis channel carrying committed changes/events for a board across API instances. */
export const boardChannel = (boardId: string) => `inkflow:board:${boardId}`;
/** Redis hash holding presence for a board (field = clientId). */
export const presenceKey = (boardId: string) => `inkflow:presence:${boardId}`;
