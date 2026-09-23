# Inkflow

Inkflow is an infinite-canvas whiteboard and diagramming platform in the style of Excalidraw. It
draws with a hand-drawn look, has a semantic diagram engine (smart connectors, automatic routing
and layout, ER, UML and sequence diagrams), supports real-time multiplayer and offline editing, and
exports to PNG, SVG, PDF and JSON. PostgreSQL is the source of truth, and it runs locally with
Podman.

![stack](https://img.shields.io/badge/stack-React%2019%20·%20NestJS%2011%20·%20PostgreSQL%2017%20·%20Redis%207-6965db)

## Features

- **Canvas**: infinite pan/zoom (wheel, trackpad pinch, touch pinch, space-drag, middle mouse),
  HiDPI rendering, viewport culling, cached drawables, 10k+ element boards.
- **Tools**: selection, hand, rectangle, rounded rectangle, ellipse, diamond, triangle, polygon,
  star, line, arrow, connector, pencil, brush, highlighter, eraser, text, image, frame, diagram node,
  comment, laser pointer.
- **Hand-drawn style**: deterministic sketchy strokes (seeded), hachure, cross-hatch, zigzag and solid
  fills, three sloppiness levels. Rendering is identical across reloads, devices, exports and
  collaborators.
- **Editing**: multi-select, marquee, shift/ctrl-click, click-through, rotation-aware resize with
  aspect lock and center scaling, rotation snapping, flips, groups (nested), frames, alignment and
  distribution, layers (z-order, lock, hide), object/grid/angle snapping with guides, copy/paste
  (with groups, bindings, images), duplicate, transaction-based undo/redo, full keyboard shortcuts.
- **Text**: inline editor with multiline, wrapping, auto width or fixed width, fonts, size, bold,
  italic, underline, alignment, line height and letter spacing.
- **Diagrams**: 50+ node shapes, 50+ icons, 60+ library symbols, ports, smart connectors (straight,
  curved, bézier, elbow, orthogonal obstacle-avoiding routing), automatic layout (hierarchical, tree,
  grid, horizontal, vertical, force-directed), ER tables with crow's-foot relationships, UML classes,
  sequence diagrams, 25+ editable templates, Mermaid import.
- **Collaboration**: live cursors, selections, presence, follow mode, real-time operations over
  WebSockets with Redis fan-out, offline queueing and reconnection, comments with replies,
  mentions and resolve/reopen, sharing (owner/editor/viewer, expiring links).
- **Persistence**: autosave to PostgreSQL, IndexedDB cache, automatic and manual version history
  with comparison and restore.
- **Workspace**: workspaces, members and roles, projects, folders, favorites, recent, shared with
  me, trash with restore, search across boards.
- **Export/import**: PNG (transparent, scaled, re-importable), vector SVG, PDF (one page per frame),
  JSON. Imports native JSON, Excalidraw, SVG, images and Mermaid.
- **Presentation**: frames become slides, fullscreen, keyboard navigation, laser pointer.
- **Accounts**: email/password with verification, password reset, sessions, Google and GitHub
  OAuth (optional), CSRF protection, rate limiting.

## Quick start (local development)

Prerequisites: Node.js ≥ 22.12 (24 recommended), pnpm 10, Podman with `podman compose`
(on macOS: `brew install podman podman-compose` and `podman machine init && podman machine start`).

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
podman compose up -d postgres redis minio minio-init mailpit
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm dev
```

- Web app: http://localhost:5173 (proxies `/api` and the WebSocket to the API on :4310)
- API docs (OpenAPI): http://localhost:5173/api/docs
- Emails (verification, resets, invites): Mailpit at http://localhost:8026
- MinIO console: http://localhost:9001 (user `inkflow`, password `inkflow-dev-secret`)

The seed creates the demo account **demo@inkflow.dev / inkflow-demo-2024** with a demo workspace
containing a flowchart, an ER diagram, an architecture diagram, a UML diagram, a mind map and a
kanban board.

Host ports can be changed through `INKFLOW_POSTGRES_PORT`, `INKFLOW_REDIS_PORT`,
`INKFLOW_MINIO_PORT`, `INKFLOW_SMTP_PORT`, `INKFLOW_MAILPIT_UI_PORT` and `INKFLOW_WEB_PORT`.

### Full stack in containers

```bash
podman compose --profile app up -d --build
```

This builds and runs the API and the web app (nginx) as well; open http://localhost:8190.

## Commands

| Command                             | Description                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`                          | Build packages, then run packages in watch mode, the API and the web dev server |
| `pnpm build`                        | Production build of all packages, the API and the web app                       |
| `pnpm test`                         | Unit tests for every package and the web app, plus API unit tests               |
| `pnpm test:integration`             | API integration tests against real PostgreSQL, Redis, MinIO and Mailpit         |
| `pnpm test:e2e`                     | Playwright end-to-end tests (starts the API and web app)                        |
| `pnpm lint` / `pnpm lint:fix`       | ESLint (zero warnings allowed)                                                  |
| `pnpm format` / `pnpm format:check` | Prettier                                                                        |
| `pnpm typecheck`                    | TypeScript for every workspace                                                  |
| `pnpm db:migrate`                   | Create/apply migrations in development (`prisma migrate dev`)                   |
| `pnpm db:migrate:deploy`            | Apply migrations in production (`prisma migrate deploy`)                        |
| `pnpm db:seed`                      | Seed the demo workspace, boards and templates                                   |
| `pnpm db:reset`                     | Drop and recreate the development database                                      |
| `pnpm infra:up` / `pnpm infra:down` | Start/stop the Podman infrastructure services                                   |

## Repository layout

```text
apps/
  api/            NestJS API: REST, WebSocket gateway, jobs, seed
  web/            React app: dashboard, auth, settings, board editor
packages/
  shared/         API contracts, roles, errors, utilities
  config/         Environment schema
  geometry/       Math, paths, spatial index, seeded random
  elements/       Element model, schema, text layout, hit testing
  scene/          Scene store, history, operations, migrations
  diagram-engine/ Shapes, icons, ports, routing, layout, ER/UML/sequence, templates
  renderer/       Hand-drawn canvas & SVG renderer
  canvas-engine/  Editor core: tools, interactions, selection, snapping, shortcuts
  collaboration/  Sync protocol and client
  exporters/      PNG, SVG, PDF, JSON
  importers/      JSON, Excalidraw, SVG, Mermaid, images
  database/       Prisma schema, migrations, client
  ui/             Accessible UI components
e2e/              Playwright tests
infra/            Container init scripts
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): system design, layers, data flow, security model
- [CANVAS_ENGINE.md](CANVAS_ENGINE.md): editor core, rendering pipeline, performance
- [DIAGRAM_ENGINE.md](DIAGRAM_ENGINE.md): shapes, ports, routing, layout, templates, importers
- [COLLABORATION.md](COLLABORATION.md): operations, conflict resolution, protocol, offline sync
- [DATABASE.md](DATABASE.md): PostgreSQL schema, constraints, migrations
- [DEPLOYMENT.md](DEPLOYMENT.md): production configuration and deployment
- [docs/API_CONTRACT.md](docs/API_CONTRACT.md): REST and WebSocket contract

## Configuration

All configuration comes from environment variables, documented in [.env.example](.env.example)
and validated at startup (`packages/config/src/env.ts`). OAuth, SMTP and S3 credentials are
optional in development: without SMTP, emails are logged by the API, and the OAuth buttons only
appear when a provider is configured.
