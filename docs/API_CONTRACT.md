# Inkflow API contract

All routes are served under the `/api` prefix (e.g. `POST /api/auth/login`). Request/response
types are defined in `packages/shared/src/api/*` (Zod request schemas + DTO interfaces) and the
collaboration types in `packages/collaboration/src/protocol.ts` and `packages/scene/src/operations.ts`.

## Conventions

- JSON bodies; dates are ISO-8601 strings.
- Errors always use `ApiErrorBody` (`{ error: { code, message, details?, requestId? } }`) with the
  codes from `packages/shared/src/errors.ts`. Validation errors → `400 VALIDATION_FAILED` with Zod
  issues in `details`.
- Authentication: HttpOnly cookies `inkflow_at` (access JWT, ~15 min) and `inkflow_rt` (opaque
  refresh token, path `/api/auth`, rotated on every refresh with reuse detection). Clients may also
  send `Authorization: Bearer <access token>`.
- CSRF: double-submit cookie. `GET /api/auth/csrf` sets the readable cookie `inkflow_csrf` and
  returns the token; every non-GET/HEAD/OPTIONS request authenticated by cookie must send the same
  value in the `x-csrf-token` header, otherwise `403 CSRF_INVALID`. (Bearer-token requests are
  exempt.) Login/register/refresh responses also (re)issue the CSRF cookie.
- A `401 UNAUTHORIZED` / `SESSION_EXPIRED` means the client should call `POST /auth/refresh` once
  and retry; if refresh fails, the user is signed out.
- Share links: anonymous or signed-in visitors pass the share token in the `x-share-token` header
  (or `st` query parameter for `<img>`/WebSocket URLs). The token grants the link's role on that
  board only.
- Rate limiting: `429 RATE_LIMITED` with a `Retry-After` header.
- `OkResponse` = `{ "ok": true }`.

Roles: board `OWNER > EDITOR > VIEWER`; workspace `OWNER > ADMIN > MEMBER`. Effective board role =
max(board owner → OWNER, board_members role, workspace ADMIN/OWNER → OWNER, workspace MEMBER →
board.workspaceAccess (NONE/VIEWER/EDITOR), valid share link role). No access → `404 NOT_FOUND`
(existence is not leaked); insufficient role → `403 FORBIDDEN`.

## Auth — `/auth`

| Method | Path | Body / Query | Response | Notes |
| --- | --- | --- | --- | --- |
| GET | `/auth/csrf` | – | `CsrfResponse` | public; sets CSRF cookie |
| GET | `/auth/providers` | – | `AuthProvidersResponse` | public |
| POST | `/auth/register` | `RegisterRequest` | `RegisterResponse` | public; sends verification email. If `REQUIRE_EMAIL_VERIFICATION=false`, signs in immediately |
| POST | `/auth/verify-email` | `TokenRequest` | `AuthResponse` | public; marks verified, signs in |
| POST | `/auth/resend-verification` | `EmailOnlyRequest` | `OkResponse` | public; always ok |
| POST | `/auth/login` | `LoginRequest` | `AuthResponse` | `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED` |
| POST | `/auth/refresh` | – (refresh cookie) | `AuthResponse` | public; `401 SESSION_EXPIRED` |
| POST | `/auth/logout` | – | `OkResponse` | revokes current session, clears cookies |
| POST | `/auth/forgot-password` | `EmailOnlyRequest` | `OkResponse` | public; always ok |
| POST | `/auth/reset-password` | `ResetPasswordRequest` | `OkResponse` | public; revokes all sessions |
| POST | `/auth/change-password` | `ChangePasswordRequest` | `OkResponse` | revokes other sessions |
| GET | `/auth/me` | – | `AuthResponse` | |
| GET | `/auth/sessions` | – | `SessionDto[]` | |
| DELETE | `/auth/sessions/:id` | – | `OkResponse` | |
| GET | `/auth/oauth/:provider` | `?next=/path` | 302 | public; provider = google \| github |
| GET | `/auth/oauth/:provider/callback` | provider params | 302 → `${WEB_ORIGIN}/auth/callback?status=success\|error&code=…&next=…` | public |

## Users — `/users`

| GET | `/users/me` | – | `UserDto` |
| PATCH | `/users/me` | `UpdateMeRequest` | `UserDto` |
| GET | `/users/search` | `?q=&workspaceId=&boardId=` | `PublicUserDto[]` (only users sharing that workspace/board; used for @mentions & invites) |

## Workspaces, members, invitations

| GET | `/workspaces` | – | `WorkspaceDto[]` |
| POST | `/workspaces` | `CreateWorkspaceRequest` | `WorkspaceDto` |
| GET | `/workspaces/:id` | – | `WorkspaceDto` |
| PATCH | `/workspaces/:id` | `UpdateWorkspaceRequest` | `WorkspaceDto` (ADMIN+) |
| DELETE | `/workspaces/:id` | – | `OkResponse` (OWNER) |
| GET | `/workspaces/:id/members` | – | `WorkspaceMemberDto[]` |
| PATCH | `/workspaces/:id/members/:userId` | `UpdateMemberRoleRequest` | `WorkspaceMemberDto` (ADMIN+, only OWNER grants OWNER, last owner can't be demoted) |
| DELETE | `/workspaces/:id/members/:userId` | – | `OkResponse` (ADMIN+, or self to leave; last owner can't leave) |
| GET | `/workspaces/:id/invitations` | – | `WorkspaceInvitationDto[]` (ADMIN+) |
| POST | `/workspaces/:id/invitations` | `InviteMemberRequest` | `InviteMemberResponse` (ADMIN+; existing user → added + notified; else emailed invite link `${WEB_ORIGIN}/invite/:token`) |
| DELETE | `/workspaces/:id/invitations/:invitationId` | – | `OkResponse` |
| GET | `/invitations/:token` | – | `InvitationPreviewDto` (public) |
| POST | `/invitations/:token/accept` | – | `WorkspaceDto` (signed-in user whose email matches) |

## Projects & folders

| GET | `/workspaces/:id/projects` | – | `ProjectDto[]` |
| POST | `/workspaces/:id/projects` | `CreateProjectRequest` | `ProjectDto` |
| PATCH | `/projects/:id` | `UpdateProjectRequest` | `ProjectDto` |
| DELETE | `/projects/:id` | – | `OkResponse` (its boards move to the trash) |
| GET | `/workspaces/:id/folders` | – | `FolderDto[]` |
| POST | `/workspaces/:id/folders` | `CreateFolderRequest` | `FolderDto` |
| PATCH | `/folders/:id` | `UpdateFolderRequest` | `FolderDto` |
| DELETE | `/folders/:id` | – | `OkResponse` (boards move to the parent folder / root) |

## Boards

| GET | `/boards` | `ListBoardsQuery` | `BoardSummaryDto[]` (`filter`: all\|recent\|favorites\|shared\|trash) |
| POST | `/boards` | `CreateBoardRequest` | `BoardSummaryDto` (optional `templateId` or `document`) |
| GET | `/boards/:id` | – | `BoardDetailDto` (records "recently viewed") |
| PATCH | `/boards/:id` | `UpdateBoardRequest` | `BoardSummaryDto` |
| DELETE | `/boards/:id` | – | `OkResponse` (soft delete → trash; OWNER or workspace ADMIN) |
| POST | `/boards/:id/restore` | – | `BoardSummaryDto` |
| DELETE | `/boards/:id/permanent` | – | `OkResponse` (only boards in the trash) |
| POST | `/boards/trash/empty` | `{ workspaceId }` | `{ deleted: number }` |
| POST | `/boards/:id/duplicate` | – | `BoardSummaryDto` |
| PUT | `/boards/:id/favorite` | – | `OkResponse` |
| DELETE | `/boards/:id/favorite` | – | `OkResponse` |
| PUT | `/boards/:id/thumbnail` | multipart `file` (png/webp ≤ 2 MB) | `OkResponse` (EDITOR+) |
| GET | `/boards/:id/thumbnail` | – | image bytes |
| POST | `/boards/:id/operations` | `{ clientId, batchId, ops: Operation[] }` | `{ results: OpResult[]; changes: ServerChange[]; seq: number }` (EDITOR+; HTTP fallback for the socket) |
| GET | `/boards/:id/changes` | `?since=<seq>` | `{ seq: number; changes: ServerChange[] \| null }` (null → reload document) |

## Sharing

| GET | `/boards/:id/sharing` | – | `BoardSharingDto` (EDITOR+) |
| POST | `/boards/:id/shares` | `AddBoardShareRequest` | `BoardSharingDto` (EDITOR+ may grant ≤ own role) |
| PATCH | `/boards/:id/members/:userId` | `UpdateBoardMemberRequest` | `BoardSharingDto` (OWNER) |
| DELETE | `/boards/:id/members/:userId` | – | `BoardSharingDto` (OWNER, or self) |
| DELETE | `/boards/:id/shares/:shareId` | – | `BoardSharingDto` (revoke pending invite) |
| POST | `/boards/:id/share-links` | `CreateShareLinkRequest` | `ShareLinkDto` (EDITOR+; link = `${WEB_ORIGIN}/s/:token`) |
| DELETE | `/boards/:id/share-links/:linkId` | – | `OkResponse` |
| GET | `/share-links/:token` | – | `ResolvedShareLinkDto` (public; 404 if revoked/expired) |

## Versions

| GET | `/boards/:id/versions` | – | `BoardVersionDto[]` |
| POST | `/boards/:id/versions` | `CreateVersionRequest` | `BoardVersionDto` (EDITOR+) |
| GET | `/boards/:id/versions/:versionId` | – | `BoardVersionDetailDto` |
| POST | `/boards/:id/versions/:versionId/restore` | – | `BoardVersionDto` (the automatic backup of the pre-restore state; EDITOR+; collaborators receive a `resync`) |
| GET | `/boards/:id/versions/:versionId/compare` | `?to=current\|<versionId>` | `VersionComparisonDto` |

## Comments

| GET | `/boards/:id/comments` | `?includeResolved=true` | `CommentDto[]` |
| POST | `/boards/:id/comments` | `CreateCommentRequest` | `CommentDto` (signed-in VIEWER+) |
| PATCH | `/comments/:id` | `UpdateCommentRequest` | `CommentDto` (author) |
| POST | `/comments/:id/resolve` | – | `CommentDto` |
| POST | `/comments/:id/reopen` | – | `CommentDto` |
| DELETE | `/comments/:id` | – | `OkResponse` (author or board OWNER) |
| POST | `/comments/:id/replies` | `CreateReplyRequest` | `CommentReplyDto` |
| PATCH | `/comment-replies/:id` | `CreateReplyRequest` | `CommentReplyDto` (author) |
| DELETE | `/comment-replies/:id` | – | `OkResponse` |

Mentions use the body token `@[Display Name](userId)`; the server notifies mentioned users.

## Files

| POST | `/files` | multipart `file` + field `boardId` | `FileDto` (EDITOR+ on board; png/jpeg/webp/gif/svg ≤ 20 MB, validated by magic bytes) |
| GET | `/files/:id` | – | `FileDto` |
| GET | `/files/:id/content` | `?st=` optional | file bytes (permission-checked, `Cache-Control: private`) |

## Templates, notifications, search, health

| GET | `/templates` | `?workspaceId=` | `TemplateSummaryDto[]` (system + workspace templates) |
| GET | `/templates/:id` | – | `TemplateDetailDto` |
| POST | `/templates` | `CreateTemplateRequest` | `TemplateSummaryDto` |
| DELETE | `/templates/:id` | – | `OkResponse` |
| GET | `/notifications` | `?limit=` | `NotificationListDto` |
| POST | `/notifications/:id/read` | – | `OkResponse` |
| POST | `/notifications/read-all` | – | `OkResponse` |
| GET | `/search` | `SearchQuery` | `SearchResultDto[]` |
| GET | `/health` | – | `HealthCheckDto` (liveness) |
| GET | `/health/ready` | – | `HealthCheckDto` (DB, Redis, S3; 503 when not ready) |

OpenAPI docs: `/api/docs` (JSON at `/api/docs-json`).

## WebSocket — `/api/ws`

Connect to `ws(s)://<origin>/api/ws?boardId=<id>[&st=<shareToken>]`. The upgrade is authenticated
with the access cookie (or the share token). Messages are JSON `ClientMessage` / `ServerMessage`
(`packages/collaboration/src/protocol.ts`). Flow:

1. Client sends `hello { protocol, boardId, clientId, lastSeq }`.
2. Server replies `welcome { seq, role, user, peers, missed }`. `missed` contains current states of
   elements changed after `lastSeq` (or `null` → reload over HTTP).
3. Editors send `ops { batchId, ops }`. The server applies each operation in a PostgreSQL
   transaction (dedupe on `(clientId, opId)`, board-wide `seq`), then broadcasts
   `changes { changes: ServerChange[] }` to every client in the room (sender included) via Redis
   pub/sub and replies `ack { batchId, results }` to the sender.
4. `transient { elements }` (live drag previews) are relayed to peers, never persisted.
5. `presence { state }` updates are throttled by clients, stored in Redis with a TTL, relayed as
   `presence { peer }`; disconnects produce `peer-left`.
6. `event { event: BoardEvent }` notifies comment changes, renames, permission changes, deletion
   and version restores. `resync` asks the client to reload the document.
7. `ping`/`pong` heartbeat every 15 s; idle sockets are closed after 45 s without traffic.

Close codes are listed in `CLOSE_CODES`.
