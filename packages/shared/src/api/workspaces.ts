import { z } from 'zod';
import { WORKSPACE_ROLES, type WorkspaceRole } from '../roles';
import { emailSchema, type IsoDate, type PublicUserDto } from './common';

export const createWorkspaceSchema = z.object({ name: z.string().trim().min(1).max(80) });
export type CreateWorkspaceRequest = z.input<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({ name: z.string().trim().min(1).max(80) });
export type UpdateWorkspaceRequest = z.input<typeof updateWorkspaceSchema>;

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(WORKSPACE_ROLES).exclude(['OWNER']).default('MEMBER'),
});
export type InviteMemberRequest = z.input<typeof inviteMemberSchema>;

export const updateMemberRoleSchema = z.object({ role: z.enum(WORKSPACE_ROLES) });
export type UpdateMemberRoleRequest = z.input<typeof updateMemberRoleSchema>;

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  memberCount: number;
  boardCount: number;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface WorkspaceMemberDto {
  user: PublicUserDto;
  role: WorkspaceRole;
  joinedAt: IsoDate;
}

export interface WorkspaceInvitationDto {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: PublicUserDto;
  expiresAt: IsoDate;
  createdAt: IsoDate;
}

export interface InviteMemberResponse {
  /** `added` when the email belonged to an existing user, `invited` when an email invitation was sent. */
  status: 'added' | 'invited';
  member?: WorkspaceMemberDto;
  invitation?: WorkspaceInvitationDto;
}

export interface InvitationPreviewDto {
  workspaceName: string;
  invitedBy: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: IsoDate;
}

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
});
export type CreateProjectRequest = z.input<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectRequest = z.input<typeof updateProjectSchema>;

export interface ProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  boardCount: number;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  projectId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
});
export type CreateFolderRequest = z.input<typeof createFolderSchema>;

export const updateFolderSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().nullable().optional(),
});
export type UpdateFolderRequest = z.input<typeof updateFolderSchema>;

export interface FolderDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  parentId: string | null;
  name: string;
  createdAt: IsoDate;
}
