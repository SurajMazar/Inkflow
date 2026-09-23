/**
 * Typed wrappers for every route of `docs/API_CONTRACT.md`. All paths are relative to `/api`.
 * Every method accepts optional `CallOptions` (`shareToken`, `signal`) as its last argument.
 */
import type {
  AddBoardShareRequest,
  AuthProvidersResponse,
  AuthResponse,
  BoardDetailDto,
  BoardSharingDto,
  BoardSummaryDto,
  BoardVersionDetailDto,
  BoardVersionDto,
  ChangePasswordRequest,
  CommentDto,
  CommentReplyDto,
  CreateBoardRequest,
  CreateCommentRequest,
  CreateFolderRequest,
  CreateProjectRequest,
  CreateReplyRequest,
  CreateShareLinkRequest,
  CreateTemplateRequest,
  CreateVersionRequest,
  CreateWorkspaceRequest,
  CsrfResponse,
  EmailOnlyRequest,
  FileDto,
  FolderDto,
  HealthCheckDto,
  InvitationPreviewDto,
  InviteMemberRequest,
  InviteMemberResponse,
  ListBoardsQuery,
  LoginRequest,
  NotificationListDto,
  OAuthProvider,
  OkResponse,
  ProjectDto,
  PublicUserDto,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  ResolvedShareLinkDto,
  SearchQuery,
  SearchResultDto,
  SessionDto,
  ShareLinkDto,
  TemplateDetailDto,
  TemplateSummaryDto,
  TokenRequest,
  UpdateBoardMemberRequest,
  UpdateBoardRequest,
  UpdateCommentRequest,
  UpdateFolderRequest,
  UpdateMeRequest,
  UpdateMemberRoleRequest,
  UpdateProjectRequest,
  UpdateWorkspaceRequest,
  UserDto,
  VersionComparisonDto,
  WorkspaceDto,
  WorkspaceInvitationDto,
  WorkspaceMemberDto,
} from '@inkflow/shared';
import { SHARE_TOKEN_QUERY } from '@inkflow/shared';
import type { Operation } from '@inkflow/scene';
import type { OpResult, ServerChange } from '@inkflow/collaboration';
import {
  API_BASE_URL,
  buildUrl,
  markSessionActive,
  markSessionEnded,
  refreshSession,
  request,
  type CallOptions,
  type QueryParams,
} from './client';
import { uploadWithProgress, type UploadOptions } from './upload';

const enc = encodeURIComponent;

export interface SubmitOperationsRequest {
  clientId: string;
  batchId: string;
  ops: Operation[];
}

export interface SubmitOperationsResponse {
  results: OpResult[];
  changes: ServerChange[];
  seq: number;
}

export interface BoardChangesResponse {
  seq: number;
  /** `null` → too far behind; reload the document. */
  changes: ServerChange[] | null;
}

export interface UserSearchQuery {
  q: string;
  workspaceId?: string;
  boardId?: string;
}

export type VersionCompareTarget = 'current' | (string & {});

const toQuery = (value: object): QueryParams => value as QueryParams;

/** Absolute (same-origin) URL of a path under the API, with optional share token. */
function withShareToken(path: string, shareToken?: string | null): string {
  return buildUrl(path, shareToken ? { [SHARE_TOKEN_QUERY]: shareToken } : undefined);
}

async function markActive<T extends { user: UserDto }>(promise: Promise<T>): Promise<T> {
  const result = await promise;
  markSessionActive();
  return result;
}

export const api = {
  auth: {
    csrf: (opts?: CallOptions) =>
      request<CsrfResponse>('GET', '/auth/csrf', { ...opts, skipAuthRefresh: true }),
    providers: (opts?: CallOptions) =>
      request<AuthProvidersResponse>('GET', '/auth/providers', { ...opts, skipAuthRefresh: true }),
    register: async (body: RegisterRequest, opts?: CallOptions) => {
      const res = await request<RegisterResponse>('POST', '/auth/register', {
        ...opts,
        body,
        skipAuthRefresh: true,
      });
      if (!res.requiresVerification) markSessionActive();
      return res;
    },
    verifyEmail: (body: TokenRequest, opts?: CallOptions) =>
      markActive(
        request<AuthResponse>('POST', '/auth/verify-email', {
          ...opts,
          body,
          skipAuthRefresh: true,
        }),
      ),
    resendVerification: (body: EmailOnlyRequest, opts?: CallOptions) =>
      request<OkResponse>('POST', '/auth/resend-verification', {
        ...opts,
        body,
        skipAuthRefresh: true,
      }),
    login: (body: LoginRequest, opts?: CallOptions) =>
      markActive(
        request<AuthResponse>('POST', '/auth/login', { ...opts, body, skipAuthRefresh: true }),
      ),
    /** Single-flight session refresh (shared with the automatic 401 handling). */
    refresh: () => refreshSession(),
    logout: async (opts?: CallOptions) => {
      try {
        return await request<OkResponse>('POST', '/auth/logout', {
          ...opts,
          skipAuthRefresh: true,
        });
      } finally {
        markSessionEnded();
      }
    },
    forgotPassword: (body: EmailOnlyRequest, opts?: CallOptions) =>
      request<OkResponse>('POST', '/auth/forgot-password', {
        ...opts,
        body,
        skipAuthRefresh: true,
      }),
    resetPassword: (body: ResetPasswordRequest, opts?: CallOptions) =>
      request<OkResponse>('POST', '/auth/reset-password', { ...opts, body, skipAuthRefresh: true }),
    changePassword: (body: ChangePasswordRequest, opts?: CallOptions) =>
      request<OkResponse>('POST', '/auth/change-password', { ...opts, body }),
    me: (opts?: CallOptions) => markActive(request<AuthResponse>('GET', '/auth/me', opts)),
    sessions: (opts?: CallOptions) => request<SessionDto[]>('GET', '/auth/sessions', opts),
    revokeSession: (sessionId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/auth/sessions/${enc(sessionId)}`, opts),
    /** Full-page navigation target that starts the OAuth flow. */
    oauthUrl: (provider: OAuthProvider, next?: string) =>
      buildUrl(`/auth/oauth/${enc(provider)}`, next ? { next } : undefined),
  },

  users: {
    me: (opts?: CallOptions) => request<UserDto>('GET', '/users/me', opts),
    updateMe: (body: UpdateMeRequest, opts?: CallOptions) =>
      request<UserDto>('PATCH', '/users/me', { ...opts, body }),
    search: (query: UserSearchQuery, opts?: CallOptions) =>
      request<PublicUserDto[]>('GET', '/users/search', { ...opts, query: toQuery(query) }),
  },

  workspaces: {
    list: (opts?: CallOptions) => request<WorkspaceDto[]>('GET', '/workspaces', opts),
    create: (body: CreateWorkspaceRequest, opts?: CallOptions) =>
      request<WorkspaceDto>('POST', '/workspaces', { ...opts, body }),
    get: (workspaceId: string, opts?: CallOptions) =>
      request<WorkspaceDto>('GET', `/workspaces/${enc(workspaceId)}`, opts),
    update: (workspaceId: string, body: UpdateWorkspaceRequest, opts?: CallOptions) =>
      request<WorkspaceDto>('PATCH', `/workspaces/${enc(workspaceId)}`, { ...opts, body }),
    remove: (workspaceId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/workspaces/${enc(workspaceId)}`, opts),
    members: (workspaceId: string, opts?: CallOptions) =>
      request<WorkspaceMemberDto[]>('GET', `/workspaces/${enc(workspaceId)}/members`, opts),
    updateMember: (
      workspaceId: string,
      userId: string,
      body: UpdateMemberRoleRequest,
      opts?: CallOptions,
    ) =>
      request<WorkspaceMemberDto>(
        'PATCH',
        `/workspaces/${enc(workspaceId)}/members/${enc(userId)}`,
        { ...opts, body },
      ),
    /** Removes a member (ADMIN+), or leaves the workspace when `userId` is the current user. */
    removeMember: (workspaceId: string, userId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/workspaces/${enc(workspaceId)}/members/${enc(userId)}`, opts),
    invitations: (workspaceId: string, opts?: CallOptions) =>
      request<WorkspaceInvitationDto[]>('GET', `/workspaces/${enc(workspaceId)}/invitations`, opts),
    invite: (workspaceId: string, body: InviteMemberRequest, opts?: CallOptions) =>
      request<InviteMemberResponse>('POST', `/workspaces/${enc(workspaceId)}/invitations`, {
        ...opts,
        body,
      }),
    revokeInvitation: (workspaceId: string, invitationId: string, opts?: CallOptions) =>
      request<OkResponse>(
        'DELETE',
        `/workspaces/${enc(workspaceId)}/invitations/${enc(invitationId)}`,
        opts,
      ),
  },

  invitations: {
    preview: (token: string, opts?: CallOptions) =>
      request<InvitationPreviewDto>('GET', `/invitations/${enc(token)}`, {
        ...opts,
        skipAuthRefresh: true,
      }),
    accept: (token: string, opts?: CallOptions) =>
      request<WorkspaceDto>('POST', `/invitations/${enc(token)}/accept`, opts),
  },

  projects: {
    list: (workspaceId: string, opts?: CallOptions) =>
      request<ProjectDto[]>('GET', `/workspaces/${enc(workspaceId)}/projects`, opts),
    create: (workspaceId: string, body: CreateProjectRequest, opts?: CallOptions) =>
      request<ProjectDto>('POST', `/workspaces/${enc(workspaceId)}/projects`, { ...opts, body }),
    update: (projectId: string, body: UpdateProjectRequest, opts?: CallOptions) =>
      request<ProjectDto>('PATCH', `/projects/${enc(projectId)}`, { ...opts, body }),
    /** Deletes the project; its boards move to the trash. */
    remove: (projectId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/projects/${enc(projectId)}`, opts),
  },

  folders: {
    list: (workspaceId: string, opts?: CallOptions) =>
      request<FolderDto[]>('GET', `/workspaces/${enc(workspaceId)}/folders`, opts),
    create: (workspaceId: string, body: CreateFolderRequest, opts?: CallOptions) =>
      request<FolderDto>('POST', `/workspaces/${enc(workspaceId)}/folders`, { ...opts, body }),
    update: (folderId: string, body: UpdateFolderRequest, opts?: CallOptions) =>
      request<FolderDto>('PATCH', `/folders/${enc(folderId)}`, { ...opts, body }),
    /** Deletes the folder; its boards move to the parent folder (or project root). */
    remove: (folderId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/folders/${enc(folderId)}`, opts),
  },

  boards: {
    list: (query: ListBoardsQuery = {}, opts?: CallOptions) =>
      request<BoardSummaryDto[]>('GET', '/boards', { ...opts, query: toQuery(query) }),
    create: (body: CreateBoardRequest, opts?: CallOptions) =>
      request<BoardSummaryDto>('POST', '/boards', { ...opts, body }),
    /** Full board with document (records a "recently viewed" entry). */
    get: (boardId: string, opts?: CallOptions) =>
      request<BoardDetailDto>('GET', `/boards/${enc(boardId)}`, opts),
    update: (boardId: string, body: UpdateBoardRequest, opts?: CallOptions) =>
      request<BoardSummaryDto>('PATCH', `/boards/${enc(boardId)}`, { ...opts, body }),
    /** Soft delete (moves to the trash). */
    remove: (boardId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/boards/${enc(boardId)}`, opts),
    restore: (boardId: string, opts?: CallOptions) =>
      request<BoardSummaryDto>('POST', `/boards/${enc(boardId)}/restore`, opts),
    /** Permanently deletes a board that is already in the trash. */
    removePermanently: (boardId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/boards/${enc(boardId)}/permanent`, opts),
    emptyTrash: (workspaceId: string, opts?: CallOptions) =>
      request<{ deleted: number }>('POST', '/boards/trash/empty', {
        ...opts,
        body: { workspaceId },
      }),
    duplicate: (boardId: string, opts?: CallOptions) =>
      request<BoardSummaryDto>('POST', `/boards/${enc(boardId)}/duplicate`, opts),
    favorite: (boardId: string, opts?: CallOptions) =>
      request<OkResponse>('PUT', `/boards/${enc(boardId)}/favorite`, opts),
    unfavorite: (boardId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/boards/${enc(boardId)}/favorite`, opts),
    setFavorite: (boardId: string, favorite: boolean, opts?: CallOptions): Promise<OkResponse> =>
      favorite ? api.boards.favorite(boardId, opts) : api.boards.unfavorite(boardId, opts),
    /** Uploads a PNG/WebP thumbnail (≤ 2 MB; EDITOR+). */
    uploadThumbnail: (boardId: string, image: Blob, opts?: CallOptions) => {
      const form = new FormData();
      const type = image.type === 'image/webp' ? 'webp' : 'png';
      form.append('file', image, `thumbnail.${type}`);
      return request<OkResponse>('PUT', `/boards/${enc(boardId)}/thumbnail`, {
        ...opts,
        formData: form,
      });
    },
    thumbnailUrl: (boardId: string, shareToken?: string | null) =>
      withShareToken(`/boards/${enc(boardId)}/thumbnail`, shareToken),
    /** HTTP fallback for the collaboration socket (EDITOR+). */
    submitOperations: (boardId: string, body: SubmitOperationsRequest, opts?: CallOptions) =>
      request<SubmitOperationsResponse>('POST', `/boards/${enc(boardId)}/operations`, {
        ...opts,
        body,
      }),
    changes: (boardId: string, since: number, opts?: CallOptions) =>
      request<BoardChangesResponse>('GET', `/boards/${enc(boardId)}/changes`, {
        ...opts,
        query: { since },
      }),
  },

  sharing: {
    get: (boardId: string, opts?: CallOptions) =>
      request<BoardSharingDto>('GET', `/boards/${enc(boardId)}/sharing`, opts),
    /** Invites a person by email (existing users are added directly). */
    addShare: (boardId: string, body: AddBoardShareRequest, opts?: CallOptions) =>
      request<BoardSharingDto>('POST', `/boards/${enc(boardId)}/shares`, { ...opts, body }),
    updateMember: (
      boardId: string,
      userId: string,
      body: UpdateBoardMemberRequest,
      opts?: CallOptions,
    ) =>
      request<BoardSharingDto>('PATCH', `/boards/${enc(boardId)}/members/${enc(userId)}`, {
        ...opts,
        body,
      }),
    removeMember: (boardId: string, userId: string, opts?: CallOptions) =>
      request<BoardSharingDto>('DELETE', `/boards/${enc(boardId)}/members/${enc(userId)}`, opts),
    revokeShare: (boardId: string, shareId: string, opts?: CallOptions) =>
      request<BoardSharingDto>('DELETE', `/boards/${enc(boardId)}/shares/${enc(shareId)}`, opts),
    createLink: (boardId: string, body: CreateShareLinkRequest, opts?: CallOptions) =>
      request<ShareLinkDto>('POST', `/boards/${enc(boardId)}/share-links`, { ...opts, body }),
    revokeLink: (boardId: string, linkId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/boards/${enc(boardId)}/share-links/${enc(linkId)}`, opts),
    /** Public: resolves a share-link token (404 when revoked or expired). */
    resolveLink: (token: string, opts?: CallOptions) =>
      request<ResolvedShareLinkDto>('GET', `/share-links/${enc(token)}`, {
        ...opts,
        skipAuthRefresh: true,
      }),
  },

  versions: {
    list: (boardId: string, opts?: CallOptions) =>
      request<BoardVersionDto[]>('GET', `/boards/${enc(boardId)}/versions`, opts),
    create: (boardId: string, body: CreateVersionRequest = {}, opts?: CallOptions) =>
      request<BoardVersionDto>('POST', `/boards/${enc(boardId)}/versions`, { ...opts, body }),
    get: (boardId: string, versionId: string, opts?: CallOptions) =>
      request<BoardVersionDetailDto>(
        'GET',
        `/boards/${enc(boardId)}/versions/${enc(versionId)}`,
        opts,
      ),
    /** Restores a version; resolves with the automatic backup of the pre-restore state. */
    restore: (boardId: string, versionId: string, opts?: CallOptions) =>
      request<BoardVersionDto>(
        'POST',
        `/boards/${enc(boardId)}/versions/${enc(versionId)}/restore`,
        opts,
      ),
    compare: (
      boardId: string,
      versionId: string,
      to: VersionCompareTarget = 'current',
      opts?: CallOptions,
    ) =>
      request<VersionComparisonDto>(
        'GET',
        `/boards/${enc(boardId)}/versions/${enc(versionId)}/compare`,
        {
          ...opts,
          query: { to },
        },
      ),
  },

  comments: {
    list: (boardId: string, params: { includeResolved?: boolean } = {}, opts?: CallOptions) =>
      request<CommentDto[]>('GET', `/boards/${enc(boardId)}/comments`, {
        ...opts,
        query: params.includeResolved ? { includeResolved: true } : undefined,
      }),
    create: (boardId: string, body: CreateCommentRequest, opts?: CallOptions) =>
      request<CommentDto>('POST', `/boards/${enc(boardId)}/comments`, { ...opts, body }),
    update: (commentId: string, body: UpdateCommentRequest, opts?: CallOptions) =>
      request<CommentDto>('PATCH', `/comments/${enc(commentId)}`, { ...opts, body }),
    resolve: (commentId: string, opts?: CallOptions) =>
      request<CommentDto>('POST', `/comments/${enc(commentId)}/resolve`, opts),
    reopen: (commentId: string, opts?: CallOptions) =>
      request<CommentDto>('POST', `/comments/${enc(commentId)}/reopen`, opts),
    remove: (commentId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/comments/${enc(commentId)}`, opts),
    reply: (commentId: string, body: CreateReplyRequest, opts?: CallOptions) =>
      request<CommentReplyDto>('POST', `/comments/${enc(commentId)}/replies`, { ...opts, body }),
    updateReply: (replyId: string, body: CreateReplyRequest, opts?: CallOptions) =>
      request<CommentReplyDto>('PATCH', `/comment-replies/${enc(replyId)}`, { ...opts, body }),
    removeReply: (replyId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/comment-replies/${enc(replyId)}`, opts),
  },

  files: {
    /** Uploads an image for a board (EDITOR+), reporting progress. */
    upload: (file: Blob, boardId: string, opts: UploadOptions & { fileName?: string } = {}) => {
      const form = new FormData();
      form.append('boardId', boardId);
      const name = opts.fileName ?? (file instanceof File ? file.name : 'image');
      form.append('file', file, name);
      return uploadWithProgress<FileDto>('/files', form, opts);
    },
    get: (fileId: string, opts?: CallOptions) =>
      request<FileDto>('GET', `/files/${enc(fileId)}`, opts),
    /** URL of the file bytes, usable in `<img src>` (share token appended as `?st=`). */
    contentUrl: (fileId: string, shareToken?: string | null) =>
      withShareToken(`/files/${enc(fileId)}/content`, shareToken),
  },

  templates: {
    list: (workspaceId?: string, opts?: CallOptions) =>
      request<TemplateSummaryDto[]>('GET', '/templates', { ...opts, query: { workspaceId } }),
    get: (templateId: string, opts?: CallOptions) =>
      request<TemplateDetailDto>('GET', `/templates/${enc(templateId)}`, opts),
    create: (body: CreateTemplateRequest, opts?: CallOptions) =>
      request<TemplateSummaryDto>('POST', '/templates', { ...opts, body }),
    remove: (templateId: string, opts?: CallOptions) =>
      request<OkResponse>('DELETE', `/templates/${enc(templateId)}`, opts),
  },

  notifications: {
    list: (params: { limit?: number } = {}, opts?: CallOptions) =>
      request<NotificationListDto>('GET', '/notifications', { ...opts, query: toQuery(params) }),
    markRead: (notificationId: string, opts?: CallOptions) =>
      request<OkResponse>('POST', `/notifications/${enc(notificationId)}/read`, opts),
    markAllRead: (opts?: CallOptions) =>
      request<OkResponse>('POST', '/notifications/read-all', opts),
  },

  search: (query: SearchQuery, opts?: CallOptions) =>
    request<SearchResultDto[]>('GET', '/search', { ...opts, query: toQuery(query) }),

  health: (opts?: CallOptions) =>
    request<HealthCheckDto>('GET', '/health', { ...opts, skipAuthRefresh: true }),
  healthReady: (opts?: CallOptions) =>
    request<HealthCheckDto>('GET', '/health/ready', { ...opts, skipAuthRefresh: true }),
};

export type Api = typeof api;

/**
 * WebSocket URL for the collaboration endpoint (`/api/ws?boardId=…[&st=…]`), resolved against the
 * current origin (or `VITE_API_BASE_URL` when it is absolute).
 */
export function websocketUrl(boardId: string, shareToken?: string | null): string {
  const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
  const url = new URL(`${API_BASE_URL}/ws`, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('boardId', boardId);
  if (shareToken) url.searchParams.set(SHARE_TOKEN_QUERY, shareToken);
  return url.toString();
}
