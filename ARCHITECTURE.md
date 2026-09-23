# Architecture

Inkflow is a TypeScript monorepo (pnpm workspaces) with two applications and a set of layered
packages. The editor core is framework-agnostic: React renders chrome around it, but never draws
on the canvas or owns document state.

```text
┌──────────────────────────────── apps/web (React 19, Vite) ─────────────────────────────────┐
│ UI: dashboard, auth, settings, editor chrome (toolbar, properties, panels, dialogs)        │
│      │ subscribes (zustand)            │ commands (actions, API)                           │
│      ▼                                  ▼                                                   │
│ Editor State ─────────────── @inkflow/canvas-engine (Editor, tools, interactions) ──────────│
│      │ transactions                     │ pointer/keyboard/wheel/touch                     │
│      ▼                                  ▼                                                   │
│ Scene Model ───────── @inkflow/scene (Scene, History, Transaction, operations, migrations) │
│      │ element states                   │                                                  │
│      ▼                                  ▼                                                   │
│ Rendering ─────────── @inkflow/renderer (rough generator, StaticRenderer, overlay, SVG)    │
│      │                                                                                     │
│ Persistence ───────── IndexedDB (snapshots, offline op queue, pending uploads)             │
│      │                                                                                     │
│ Collaboration ─────── @inkflow/collaboration (CollabClient: ops ⇄ WebSocket/HTTP)          │
└──────┼──────────────────────────────────────────────────────────────────────────────────────┘
       ▼
┌──────────────────────────────── apps/api (NestJS 11) ───────────────────────────────────────┐
│ REST (/api/*) + WebSocket (/api/ws) · guards · validation · rate limits · OpenAPI            │
│ OperationsService: applyOperation() in PostgreSQL transactions → board_elements/operations │
│ Redis: pub/sub fan-out across instances, presence, rate limiting                            │
│ S3 (MinIO locally): images & thumbnails · SMTP: verification, resets, invites, mentions     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `@inkflow/shared` | REST DTOs + Zod request schemas, roles, error codes, ids, timing utilities | zod |
| `@inkflow/config` | Validated environment schema (`parseApiEnv`) | zod |
| `@inkflow/geometry` | Vectors, matrices, bounds, intersections, béziers, SVG path parsing, simplification, `SpatialIndex`, `SeededRandom` | – |
| `@inkflow/elements` | Element model (17 types), Zod schema, factories, text layout, element geometry & hit testing | geometry, shared |
| `@inkflow/scene` | `Scene` store with spatial/binding/group/frame indexes, `Transaction`, `History`, operations (`applyOperation`, `changesToOperations`), fractional indexing, document format + migrations, z-order, alignment, duplication | elements |
| `@inkflow/diagram-engine` | Shape & icon registries, ports and binding geometry, connector routing (orthogonal A*, elbow, bézier, curved), auto layout (Sugiyama, tidy tree, grid, force), ER/UML/sequence models, library, templates | scene |
| `@inkflow/renderer` | Deterministic hand-drawn generator, canvas renderer with culling and caches, interactive overlay, SVG renderer | diagram-engine |
| `@inkflow/canvas-engine` | `Editor`: viewport, tools, interaction controller, selection/transform/snapping, clipboard, shortcuts, actions, text editing, images, presentation | renderer |
| `@inkflow/collaboration` | WebSocket protocol, `CollabClient` sync engine | scene |
| `@inkflow/exporters` | PNG (with embedded scene), SVG, PDF (vector/raster, one page per frame), JSON | renderer |
| `@inkflow/importers` | Native/Excalidraw JSON, SVG → elements, SVG sanitizer, Mermaid → diagrams, image validation | diagram-engine |
| `@inkflow/database` | Prisma schema, migrations, Prisma client | prisma |
| `@inkflow/ui` | Accessible shadcn/ui-style components on Radix | react |

Packages are built with tsup (ESM + CJS + d.ts). Each exposes a `source` export condition, so Vite
and Vitest consume TypeScript sources directly while the API (CommonJS) uses the build output.

## Data flow of an edit

1. A pointer gesture starts a `Transaction` (`editor.beginGesture`). Every pointer move patches the
   scene immediately (so it renders at 60 fps) and emits a `transient` event with the live element
   states, which the sync client throttles and relays to collaborators as previews.
2. On pointer up the transaction commits: its property-level deltas become **one** history entry and
   its net changes are turned into semantic operations (`MOVE_ELEMENT`, `RESIZE_ELEMENT`,
   `GROUP_ELEMENTS`, `CREATE_CONNECTION`, …) by `changesToOperations`.
3. `CollabClient.submit` appends the operations to a pending queue persisted in IndexedDB and sends
   them in batches over the WebSocket (or HTTP when the socket is down).
4. The API applies each operation inside a PostgreSQL transaction (row locks, idempotency on
   `(board, client, opId)`, board-wide `seq`), stores the resulting element rows and the operation
   log, then publishes the resulting element states through Redis to every API instance, which
   deliver `changes` to all sockets in the board room.
5. Each client merges authoritative states (monotonic per-element versions) and re-applies its still
   pending operations on top, so local intent is never lost and all replicas converge.

See [COLLABORATION.md](COLLABORATION.md), [CANVAS_ENGINE.md](CANVAS_ENGINE.md),
[DIAGRAM_ENGINE.md](DIAGRAM_ENGINE.md) and [DATABASE.md](DATABASE.md) for details.

## Key design decisions

- **Everything is a property patch.** Deletions are tombstones (`isDeleted`), creations are
  `isDeleted: true → false`. History, undo, collaboration and conflict resolution all operate on
  per-property diffs, which makes undo collaboration-safe (it only restores the properties the user
  changed) and conflicts deterministic (per-property last writer wins, server order).
- **Fractional indices for z-order.** Reordering assigns new keys only to moved elements, so
  concurrent reorders never conflict or renumber the scene. PostgreSQL sorts them with `COLLATE "C"`.
- **Deterministic rendering.** Every element carries a `seed`; the rough generator uses an integer
  PRNG, so an element looks identical across reloads, devices, exports and collaborators.
- **Semantic diagrams.** Connectors store bindings (target element, port or anchor); their route is
  derived. Moving a node recomputes attached connectors inside the same transaction, so the change
  and its consequences are one undo step and one batch of operations.
- **Server authority, client optimism.** The client applies changes instantly; the server orders and
  validates them (Zod element schema, permissions, file ownership) and is the source of truth.
- **Offline first.** The last document, unsent operations and not-yet-uploaded images live in
  IndexedDB. The editor opens from the cache when the API is unreachable and syncs on reconnect.

## Security model

- Authentication with HttpOnly cookies (short-lived JWT + rotating refresh token with reuse
  detection), CSRF double-submit tokens, argon2id password hashes, rate limits backed by Redis.
- Every board-scoped HTTP request and every WebSocket message re-resolves the caller's effective
  role; the frontend's permission state is only used for UX.
- Uploads are validated by magic bytes, dimensions are parsed server-side, SVGs are screened for
  active content and served with a sandboxing CSP; imports are parsed as data and validated against
  the element schema — nothing imported is ever executed.
- Share links are random 256-bit tokens stored hashed (plus encrypted for owner display), optionally
  expiring, revocable.
