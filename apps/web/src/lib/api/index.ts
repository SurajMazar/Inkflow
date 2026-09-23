/**
 * Inkflow API client — the single entry point for talking to the backend.
 *
 * ```ts
 * import { api, ApiError, request } from '@/lib/api';
 * const detail = await api.boards.get(boardId, { shareToken: getShareToken(boardId) });
 * ```
 */
export { api, websocketUrl } from './endpoints';
export type {
  Api,
  BoardChangesResponse,
  SubmitOperationsRequest,
  SubmitOperationsResponse,
  UserSearchQuery,
  VersionCompareTarget,
} from './endpoints';
export {
  API_BASE_URL,
  NETWORK_ERROR_MESSAGE,
  buildUrl,
  ensureCsrfToken,
  getCsrfToken,
  markSessionActive,
  markSessionEnded,
  onSessionExpired,
  onSessionRefreshed,
  refreshSession,
  request,
  retryAfterSeconds,
} from './client';
export type { CallOptions, HttpMethod, QueryParams, RefreshOutcome, RequestOptions } from './client';
export { uploadWithProgress } from './upload';
export type { UploadOptions, UploadProgress } from './upload';
export { ApiError, isApiErrorBody } from '@inkflow/shared';
export type { ErrorCode } from '@inkflow/shared';
