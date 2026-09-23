export const BOARD_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];

export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Default access that workspace members get to a board they are not explicitly a member of. */
export const WORKSPACE_ACCESS = ['NONE', 'VIEWER', 'EDITOR'] as const;
export type WorkspaceAccess = (typeof WORKSPACE_ACCESS)[number];

export const SHARE_LINK_ROLES = ['EDITOR', 'VIEWER'] as const;
export type ShareLinkRole = (typeof SHARE_LINK_ROLES)[number];

const BOARD_ROLE_RANK: Record<BoardRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };
const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function boardRoleAtLeast(role: BoardRole | null | undefined, required: BoardRole): boolean {
  if (!role) return false;
  return BOARD_ROLE_RANK[role] >= BOARD_ROLE_RANK[required];
}

export function workspaceRoleAtLeast(
  role: WorkspaceRole | null | undefined,
  required: WorkspaceRole,
): boolean {
  if (!role) return false;
  return WORKSPACE_ROLE_RANK[role] >= WORKSPACE_ROLE_RANK[required];
}

/** Returns the most privileged of the given roles (nulls ignored). */
export function highestBoardRole(...roles: (BoardRole | null | undefined)[]): BoardRole | null {
  let best: BoardRole | null = null;
  for (const role of roles) {
    if (role && (!best || BOARD_ROLE_RANK[role] > BOARD_ROLE_RANK[best])) best = role;
  }
  return best;
}

export const canEditBoard = (role: BoardRole | null | undefined) =>
  boardRoleAtLeast(role, 'EDITOR');
export const canManageBoard = (role: BoardRole | null | undefined) =>
  boardRoleAtLeast(role, 'OWNER');
export const canViewBoard = (role: BoardRole | null | undefined) =>
  boardRoleAtLeast(role, 'VIEWER');
/** Every role that can view a board can comment on it. */
export const canCommentOnBoard = canViewBoard;
