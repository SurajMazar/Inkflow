# Real-time collaboration

Inkflow uses server-ordered **operations** with per-property last-writer-wins merging. Clients edit
optimistically; the API sequences and validates operations in PostgreSQL and fans the results out
through Redis. Offline edits are queued durably and replayed idempotently.

## Operations

Defined in `packages/scene/src/operations.ts`. Every operation carries:

| Field | Meaning |
| --- | --- |
| `opId` | Unique id; `(boardId, clientId, opId)` is the idempotency key |
| `clientId` | Editor session that produced it |
| `clientSeq` | Monotonic per-client counter |
| `timestamp` | Client clock (informational) |
| `baseVersion` | Element version the change was based on (conflict detection) |

Types: `CREATE_ELEMENT`, `UPDATE_ELEMENT`, `DELETE_ELEMENT`, `MOVE_ELEMENT`, `RESIZE_ELEMENT`,
`ROTATE_ELEMENT`, `GROUP_ELEMENTS`, `UNGROUP_ELEMENTS`, `CREATE_CONNECTION`, `DELETE_CONNECTION`.
The server assigns a board-wide `seq` to each applied operation.

`changesToOperations` derives the most specific type from a committed transaction (a pure `x/y`
change becomes `MOVE_ELEMENT`, size changes `RESIZE_ELEMENT`, appending the same group to several
elements one `GROUP_ELEMENTS`, …). Only changed properties travel — never the whole canvas.

## Conflict resolution

`applyOperation` (shared by client and server) is deterministic:

- Properties merge individually; the operation applied later in server order wins per property.
  Two users moving and recoloring the same shape both keep their change.
- Deletes are tombstones and win over concurrent edits unless an operation explicitly revives the
  element (`isDeleted: false`, e.g. undo of a delete).
- Group operations are idempotent set additions/removals, so concurrent grouping never duplicates ids.
- Every applied operation bumps the element `version`; `baseVersion < version` marks a merged conflict.
- Results are validated against the element schema; invalid operations are rejected individually
  and the client rolls its optimistic state back to the authoritative one.

Z-order uses fractional indices, so concurrent reorders or inserts at the same position cannot
conflict; ties are broken by element id.

## Protocol (`packages/collaboration/src/protocol.ts`)

```text
client                                   server
  │── hello {boardId, clientId, lastSeq} ──▶│  authenticate (cookie or share token), resolve role
  │◀── welcome {seq, role, peers, missed} ──│  missed = current states of elements changed after lastSeq
  │── ops {batchId, ops[]} ────────────────▶│  apply in one PostgreSQL transaction, publish via Redis
  │◀── changes {changes[]} ─────────────────│  (to every client, sender included)
  │◀── ack {batchId, results[]} ────────────│  applied | duplicate | rejected
  │── transient {elements[]} ──────────────▶│  live drag previews, relayed, never stored
  │── presence {cursor, selection, tool…} ─▶│  Redis hash with TTL, relayed as presence/peer-left
  │◀── event {comments-changed | …} ────────│
  │── ping / ◀── pong                       │  heartbeat every 15 s
```

## Client sync engine (`CollabClient`)

- **Pending queue**: committed local operations are appended, persisted to IndexedDB
  (`pendingOps` store), and flushed every ~80 ms in batches of up to 500.
- **Rebasing**: the client keeps the authoritative element states it has seen. When changes arrive
  it re-applies still-pending local operations on top and hands the result to the editor, so
  concurrent remote edits appear without discarding local intent.
- **Acks**: applied/duplicate operations leave the queue; rejected ones are dropped and the affected
  elements revert to the authoritative state with a toast.
- **Sequence tracking**: `lastSeq` only advances contiguously, so a reconnect never skips a change.
- **Reconnection**: exponential backoff with jitter (0.5 s → 10 s), immediate retry on the browser
  `online` event, heartbeat timeouts detect dead sockets. On reconnect `hello.lastSeq` lets the
  server replay missed element states (or request a full reload when the gap is too large). Pending
  operations are resent; the server deduplicates them.
- **HTTP fallback**: while the socket is unavailable, batches go to `POST /api/boards/:id/operations`.
- **Status**: `Saving… · Saved · Offline · Syncing…` is derived from the connection state and the
  pending queue and shown in the editor top bar.

## Offline workflow

```text
User continues editing ─▶ operations queued in IndexedDB (+ document snapshot)
Connection returns     ─▶ hello(lastSeq) ─▶ missed changes merged ─▶ pending ops replayed
Server                 ─▶ dedupe, per-property merge, validation ─▶ changes broadcast
Client                 ─▶ merged document; queue empty ─▶ "Saved"
```

The last known document of each board is cached, so a board can even be opened while offline.
Images inserted offline are kept as blobs and uploaded when the network returns (their client-chosen
UUID keeps element references stable).

## Presence

Cursor, selection, tool, viewport and "editing" state are throttled to 40 ms and relayed to peers.
Peers render as colored cursors with name tags and colored selection outlines; clicking an avatar
follows that user's viewport. Presence lives in a Redis hash per board with a TTL so crashed
instances don't leave ghosts.

## Multi-instance deployment

Any API instance can serve any socket. PostgreSQL serializes operations per board (row lock on the
board), Redis pub/sub distributes committed changes, transient previews, presence and events, so
horizontally scaled instances behave like one.

## Testing

- `packages/collaboration/test/client.test.ts`: queueing, acks, rebasing, rejection rollback, offline
  persistence and replay, resync, HTTP fallback, presence.
- `packages/scene/test/operations.test.ts`: merge semantics, tombstones, idempotency, validation.
- `apps/api/test/*.int.spec.ts`: two real WebSocket clients against PostgreSQL + Redis.
- `e2e/tests/collaboration.spec.ts`: two browsers editing the same board.
