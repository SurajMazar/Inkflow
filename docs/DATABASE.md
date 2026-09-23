# Inkflow database

PostgreSQL 17 is the system of record. The schema lives in
`packages/database/prisma/schema.prisma`; migrations in `packages/database/prisma/migrations`.
`@inkflow/database` re-exports the generated Prisma client (`PrismaClient`, `Prisma`, enums, model
types) and `createPrismaClient(url?)`.

Conventions: `snake_case` tables/columns (`@@map`/`@map`), UUID primary keys
(`@db.Uuid @default(uuid())`), `created_at`/`updated_at` as `timestamptz(3)`, explicit foreign keys
with deliberate `ON DELETE` rules, and an index for every query path the API uses.

## Entity overview

```
users ─┬─< sessions               (refresh tokens, one row per issued token, grouped by family_id)
       ├─< oauth_accounts         (google/github identities; unique (provider, provider_account_id))
       ├─< password_resets        (1 h, single use, SHA-256 token hash)
       ├─< email_verifications    (24 h, single use, SHA-256 token hash)
       ├─< notifications          (recipient; actor_id → users, SET NULL)
       └─< workspace_members >─── workspaces ─┬─< workspace_invitations (pending only)
                                             ├─< projects ─< folders (tree via parent_id)
                                             ├─< templates (workspace templates; system ones have workspace_id NULL)
                                             └─< boards ─┬─< board_members        (explicit shares)
                                                         ├─< shares               (pending email shares)
                                                         ├─< share_links          (token hash + ciphertext)
                                                         ├─< board_favorites / board_views (per user)
                                                         ├─< board_elements       (current element states)
                                                         ├─< board_operations     (append-only op log)
                                                         ├─< board_versions       (snapshots)
                                                         ├─< comments ─< comment_replies
                                                         │       └─< comment_mentions (comment or reply)
                                                         ├─< files ─< file_references
                                                         └─< file_references (board_id, element_id)
```

| Table | Purpose / notable columns |
| --- | --- |
| `users` | `email` unique (always stored lower-case), `password_hash` (argon2id PHC, null for OAuth-only), `email_verified_at`, `preferences` jsonb (partial; merged over defaults by the API). |
| `sessions` | One row per refresh token: `token_hash` (unique, SHA-256), `family_id` (the logical session / `sid` claim), `started_at`, `rotated_at`, `revoked_at`, `expires_at`. |
| `workspaces`, `workspace_members` | Composite PK `(workspace_id, user_id)`, `role` OWNER/ADMIN/MEMBER. |
| `workspace_invitations` | Pending invitations; `UNIQUE (workspace_id, email)`, deleted on accept/revoke. |
| `projects`, `folders` | Folder tree (`parent_id` SET NULL); deleting a project cascades to its folders. |
| `boards` | `workspace_access` NONE/VIEWER/EDITOR, `app_state` jsonb, `seq` (last committed op), `element_count` (live elements), `ops_since_version`, `last_version_at`, `thumbnail_key`, `deleted_at`/`deleted_by` (trash). |
| `board_elements` | PK `(board_id, element_id)`; `data` jsonb (full `SceneElement`), `version`, `z_index` (`COLLATE "C"`), `is_deleted` (tombstones are kept), `search_text`. |
| `board_operations` | `bigserial` id, `seq`, `client_id`, `op_id`, `user_id`, `type`, `payload`, `element_ids text[]`. |
| `board_versions` | `number` unique per board, `kind` AUTO/MANUAL/RESTORE_BACKUP, `snapshot` jsonb (`SceneDocument`), `element_count`, `seq`. |
| `comments`, `comment_replies`, `comment_mentions` | Anchored threads; mentions reference the comment and optionally the reply. |
| `files`, `file_references` | Uploaded images (content-addressed object key `files/<sha256>`, shared by duplicated boards) and which live image element of a board uses which file (`UNIQUE (board_id, element_id)`). |
| `templates` | `key` unique for built-in (`is_system`) templates, `document` jsonb. |
| `shares`, `share_links` | Pending email shares (`UNIQUE (board_id, email)`); share links store `token_hash` (unique) and `token_ciphertext` (AES-256-GCM, key derived from `SESSION_SECRET` via HKDF) so owners can copy links again. |
| `notifications` | `type`, `title`, `body`, `link`, `data`, `read_at`. |

### Delete rules

* Deleting a **workspace** cascades to members, invitations, projects, folders, boards and workspace
  templates (the API first purges the boards' S3 objects).
* Deleting a **board** cascades to everything board-scoped (elements, operations, versions, comments,
  files, references, shares, links, favorites, views). `boards.owner_id` is `RESTRICT`: users who own
  boards cannot be deleted accidentally.
* Deleting a **project** sets `boards.project_id` to NULL (the API moves its boards to the trash first);
  deleting a **folder** sets `boards.folder_id`/child `parent_id` to NULL (the API re-parents them to
  the parent folder first).
* Author/actor references that are informational (`created_by`, `updated_by`, `resolved_by`,
  `actor_id`, `uploaded_by`, `deleted_by`) use `SET NULL`.

## Constraints and indexes (rationale)

| Index / constraint | Used by |
| --- | --- |
| `UNIQUE board_operations (board_id, seq)` | Total order per board; replay `seq > lastSeq` range scans. |
| `UNIQUE board_operations (board_id, client_id, op_id)` | **Idempotency**: a retried op is detected and answered `duplicate`. |
| `board_operations (created_at)` | Op-log compaction job. |
| `board_elements (board_id, is_deleted, z_index, element_id)` | Loading a board in z-order (`ORDER BY z_index COLLATE "C", element_id`). |
| `board_elements_search_text_trgm_idx` (GIN `gin_trgm_ops`) | Content search (`search_text ILIKE '%q%'`). |
| `boards_title_trgm_idx` (GIN `gin_trgm_ops`) | Title search. |
| `boards (workspace_id, deleted_at, updated_at DESC)` | Board lists per workspace. `boards (deleted_at)` for the trash purge. |
| `board_views (user_id, last_viewed_at DESC)`, `board_favorites (user_id, board_id)` PK | "Recent" and "Favorites" lists. |
| `UNIQUE board_versions (board_id, number)` | Version numbers never collide (concurrent auto versions retry). |
| `UNIQUE sessions (token_hash)`, `sessions (family_id)`, `sessions (user_id, revoked_at)` | Refresh lookup, family revocation, session list. |
| `UNIQUE share_links (token_hash)`, `UNIQUE oauth_accounts (provider, provider_account_id)`, `UNIQUE users (email)` | Token / identity lookups. |
| `UNIQUE file_references (board_id, element_id)`, `files (board_id, sha256)`, `files (storage_key)` | Reference maintenance, per-board upload dedupe, orphaned-object detection. |
| `notifications (user_id, created_at DESC)`, `(user_id, read_at)` | Notification list and unread count. |
| CHECKs: `boards.seq >= 0`, `element_count >= 0`, `ops_since_version >= 0`, `board_operations.seq > 0`, `board_versions.number > 0`, `files.size >= 0` | Integrity guards. |

### Raw SQL in the initial migration

Prisma cannot express everything, so `20260923080549_init/migration.sql` was generated with
`prisma migrate dev --create-only` and then edited:

1. `CREATE EXTENSION IF NOT EXISTS pg_trgm;` is **prepended** (the trigram GIN indexes declared in
   the schema need the operator class).
2. `ALTER TABLE board_elements ALTER COLUMN z_index SET DATA TYPE TEXT COLLATE "C";` — fractional
   order keys must sort by code unit exactly like the client's string comparison; locale collations
   (e.g. `en_US.utf8`) would order `a0`/`Zz`/`a` differently.
3. The CHECK constraints listed above.

None of these cause schema drift: Prisma does not diff column collations or CHECK constraints, and
the trigram indexes are declared in `schema.prisma` (`@@index([...(ops: raw("gin_trgm_ops"))], type: Gin)`).
`prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel prisma/schema.prisma` reports an
empty migration.

## Operations, conflicts and idempotency

`OperationsService.applyBatch` runs one PostgreSQL transaction per batch:

1. `SELECT … FROM boards WHERE id = $1 FOR UPDATE` — serializes writers of a board (ops, version
   restores and automatic versions all take this lock first, so they cannot interleave).
2. Looks up already-persisted `(client_id, op_id)` pairs → those ops answer `duplicate` with their
   original `seq` (retries after a lost ack are harmless).
3. Loads the target `board_elements` rows `FOR UPDATE`, applies each operation in order with
   `applyOperation(…, { validate: true })` (deterministic per-property last-writer-wins; deletes are
   tombstones). A rejected op does not abort the batch; later ops see earlier results.
4. Upserts the final element states (`INSERT … ON CONFLICT (board_id, element_id) DO UPDATE`,
   including `z_index`, `is_deleted`, `search_text`), maintains `file_references`, inserts the
   `board_operations` rows with consecutive `seq`s and bumps `boards.seq`, `element_count`,
   `ops_since_version`, `updated_at`.
5. After commit the changes are published to Redis `inkflow:board:<id>`; every API instance forwards
   them to its sockets. Reconnecting clients receive the current state of every element touched after
   their `lastSeq` (from `board_operations.element_ids`), or `null` (full reload) when the gap exceeds
   `MAX_REPLAY_ELEMENTS` or reaches into the compacted part of the log.

Automatic versions are created after commit (asynchronously) when `ops_since_version >=
AUTO_VERSION_EVERY_OPS` or `last_version_at` is older than `AUTO_VERSION_EVERY_MINUTES`; the check is
repeated under the board lock and `UNIQUE (board_id, number)` + retry prevents duplicate numbers across
instances.

## Housekeeping jobs

Hourly, guarded by `pg_try_advisory_xact_lock` so only one instance runs each job:

* **Trash purge** — boards with `deleted_at` older than `TRASH_RETENTION_DAYS` are deleted; S3 objects
  whose `storage_key` is no longer referenced by any `files` row, and thumbnails, are removed.
* **Op-log compaction** — `board_operations` older than 30 days are deleted except the latest 1 000 of
  every board (clients further behind reload the document; idempotency is only needed for recent ops).
* **Token cleanup** — expired/revoked sessions, verification and reset tokens and invitations older
  than a week.

## Migration workflow

The Prisma CLI is wrapped by `packages/database/scripts/prisma.mjs`, which loads the repository-root
`.env` (existing environment variables win).

* **Development**: edit `schema.prisma`, then `pnpm db:migrate` (`prisma migrate dev`) to create and
  apply a migration; for raw SQL use `pnpm --filter @inkflow/database migrate:dev --create-only`, edit
  the generated SQL, then run `pnpm db:migrate` again. `pnpm db:generate` regenerates the client
  (`pnpm build:packages` also does it).
* **Tests**: the API integration suite runs `prisma migrate deploy` against `TEST_DATABASE_URL`
  (`inkflow_test`) and truncates all tables before the run.
* **Production**: `pnpm db:migrate:deploy` (`prisma migrate deploy`) applies pending migrations
  without prompting; the API container runs it on start (`apps/api/docker-entrypoint.sh`).
  Migrations must be backwards compatible with the previous API version (expand → deploy → contract)
  because instances are rolled one by one.
* `pnpm db:reset` drops and re-creates the development database (destructive).

## Backups and restore

* Use continuous archiving (WAL) or managed-provider point-in-time recovery in production; a daily
  logical dump is a good complement:
  `pg_dump --format=custom --no-owner "$DATABASE_URL" > inkflow-$(date +%F).dump` and
  `pg_restore --clean --no-owner --dbname "$DATABASE_URL" inkflow.dump`.
  Locally: `podman compose exec postgres pg_dump -U inkflow -Fc inkflow > inkflow.dump`.
* Back up the S3 bucket (`files/<sha256>`, `thumbnails/…`) together with the database; objects are
  immutable and content-addressed, so a bucket snapshot taken after the database dump is consistent
  (objects without rows are harmless and removed by the purge job).
* Redis holds only ephemeral data (presence, pub/sub, rate-limit counters, revoked-session markers
  with short TTLs) and does not need backups.
* Board history can also be recovered at the application level from `board_versions` (restoring a
  version first stores a `RESTORE_BACKUP` snapshot of the current state).
