import {
  highestBoardRole,
  type BoardRole,
  type ShareLinkRole,
  type WorkspaceAccess,
  type WorkspaceRole,
} from '@inkflow/shared';

export interface RoleInputs {
  /** The principal is the board's owner. */
  isOwner: boolean;
  /** Explicit `board_members` role. */
  memberRole: BoardRole | null;
  /** The principal's role in the board's workspace. */
  workspaceRole: WorkspaceRole | null;
  /** The board's default access for workspace members. */
  workspaceAccess: WorkspaceAccess;
  /** Role granted by a valid share link presented with the request. */
  linkRole: ShareLinkRole | null;
}

export interface EffectiveRole {
  role: BoardRole | null;
  /** Role the principal has without the share link. */
  ownRole: BoardRole | null;
  /** True when the share link grants more than the principal's own access. */
  viaShareLink: boolean;
}

/** Role implied by workspace membership alone. */
export function workspaceDerivedRole(workspaceRole: WorkspaceRole | null, access: WorkspaceAccess): BoardRole | null {
  if (!workspaceRole) return null;
  if (workspaceRole === 'OWNER' || workspaceRole === 'ADMIN') return 'OWNER';
  if (access === 'EDITOR') return 'EDITOR';
  if (access === 'VIEWER') return 'VIEWER';
  return null;
}

/**
 * Effective board role = max(owner → OWNER, board member role, workspace ADMIN/OWNER → OWNER,
 * workspace MEMBER → workspaceAccess, share link role).
 */
export function computeEffectiveRole(input: RoleInputs): EffectiveRole {
  const ownRole = highestBoardRole(
    input.isOwner ? 'OWNER' : null,
    input.memberRole,
    workspaceDerivedRole(input.workspaceRole, input.workspaceAccess),
  );
  const role = highestBoardRole(ownRole, input.linkRole);
  const viaShareLink = input.linkRole !== null && role !== ownRole;
  return { role, ownRole, viaShareLink };
}
