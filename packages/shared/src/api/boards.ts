import { z } from 'zod';
import {
  BOARD_ROLES,
  SHARE_LINK_ROLES,
  WORKSPACE_ACCESS,
  type BoardRole,
  type ShareLinkRole,
  type WorkspaceAccess,
} from '../roles';
import { emailSchema, titleSchema, type IsoDate, type PublicUserDto } from './common';

/**
 * Serialized board document. Its exact structure is owned by `@inkflow/scene`
 * (see `SceneDocument`) and is validated there; the transport layer treats it opaquely.
 */
export interface SerializedDocument {
  version: number;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export const serializedDocumentSchema = z.object({
  version: z.number().int().min(1),
  elements: z.array(z.unknown()).max(100_000),
  appState: z.record(z.string(), z.unknown()).default({}),
  files: z.record(z.string(), z.unknown()).default({}),
});

export const BOARD_LIST_FILTERS = ['all', 'recent', 'favorites', 'shared', 'trash'] as const;
export type BoardListFilter = (typeof BOARD_LIST_FILTERS)[number];

export const listBoardsQuerySchema = z.object({
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  folderId: z.string().optional(),
  filter: z.enum(BOARD_LIST_FILTERS).default('all'),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListBoardsQuery = z.input<typeof listBoardsQuerySchema>;

export const createBoardSchema = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  title: titleSchema.default('Untitled board'),
  templateId: z.string().optional(),
  /** Optional initial document (imports, duplicates). Validated server-side by the scene schema. */
  document: serializedDocumentSchema.optional(),
});
export type CreateBoardRequest = z.input<typeof createBoardSchema>;

export const updateBoardSchema = z.object({
  title: titleSchema.optional(),
  projectId: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  workspaceAccess: z.enum(WORKSPACE_ACCESS).optional(),
  appState: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateBoardRequest = z.input<typeof updateBoardSchema>;

export interface BoardSummaryDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  folderId: string | null;
  title: string;
  role: BoardRole;
  workspaceAccess: WorkspaceAccess;
  isFavorite: boolean;
  thumbnailUrl: string | null;
  owner: PublicUserDto;
  elementCount: number;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  deletedAt: IsoDate | null;
  lastViewedAt: IsoDate | null;
}

export interface BoardDetailDto {
  board: BoardSummaryDto;
  document: SerializedDocument;
  /** Server sequence number of the last operation reflected in `document`. */
  seq: number;
  /** Set when the board was accessed through a share link. */
  viaShareLink: boolean;
}

export const addBoardShareSchema = z.object({
  email: emailSchema,
  role: z.enum(BOARD_ROLES).exclude(['OWNER']).default('EDITOR'),
  message: z.string().trim().max(500).optional(),
});
export type AddBoardShareRequest = z.input<typeof addBoardShareSchema>;

export const updateBoardMemberSchema = z.object({ role: z.enum(BOARD_ROLES) });
export type UpdateBoardMemberRequest = z.input<typeof updateBoardMemberSchema>;

export interface BoardMemberDto {
  user: PublicUserDto;
  role: BoardRole;
  addedAt: IsoDate;
}

export interface PendingShareDto {
  id: string;
  email: string;
  role: BoardRole;
  invitedBy: PublicUserDto;
  createdAt: IsoDate;
}

export interface BoardSharingDto {
  members: BoardMemberDto[];
  pending: PendingShareDto[];
  workspaceAccess: WorkspaceAccess;
  links: ShareLinkDto[];
}

export const createShareLinkSchema = z.object({
  role: z.enum(SHARE_LINK_ROLES).default('VIEWER'),
  /** Hours until expiry; omit for a link that never expires. */
  expiresInHours: z.number().int().min(1).max(24 * 365).optional(),
});
export type CreateShareLinkRequest = z.input<typeof createShareLinkSchema>;

export interface ShareLinkDto {
  id: string;
  boardId: string;
  role: ShareLinkRole;
  token: string;
  url: string;
  expiresAt: IsoDate | null;
  createdAt: IsoDate;
  createdBy: PublicUserDto;
  lastUsedAt: IsoDate | null;
}

export interface ResolvedShareLinkDto {
  boardId: string;
  boardTitle: string;
  role: ShareLinkRole;
  expiresAt: IsoDate | null;
}
