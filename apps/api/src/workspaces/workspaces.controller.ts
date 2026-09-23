import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createWorkspaceSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
  type CreateWorkspaceRequest,
  type InvitationPreviewDto,
  type InviteMemberRequest,
  type InviteMemberResponse,
  type OkResponse,
  type UpdateMemberRoleRequest,
  type UpdateWorkspaceRequest,
  type WorkspaceDto,
  type WorkspaceInvitationDto,
  type WorkspaceMemberDto,
} from '@inkflow/shared';
import { CurrentUser, Public, type AuthInfo } from '../common/request';
import { ApiZodBody, IdParam, ZBody } from '../common/validation';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@ApiCookieAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'Workspaces of the signed-in user' })
  list(@CurrentUser() user: AuthInfo): Promise<WorkspaceDto[]> {
    return this.workspaces.list(user.userId);
  }

  @Post()
  @ApiZodBody(createWorkspaceSchema)
  @ApiOperation({ summary: 'Create a workspace' })
  create(@CurrentUser() user: AuthInfo, @ZBody(createWorkspaceSchema) body: CreateWorkspaceRequest): Promise<WorkspaceDto> {
    return this.workspaces.create(user.userId, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a workspace' })
  get(@CurrentUser() user: AuthInfo, @IdParam('id', 'Workspace') id: string): Promise<WorkspaceDto> {
    return this.workspaces.get(user.userId, id);
  }

  @Patch(':id')
  @ApiZodBody(updateWorkspaceSchema)
  @ApiOperation({ summary: 'Rename a workspace (ADMIN+)' })
  update(
    @CurrentUser() user: AuthInfo,
    @IdParam('id', 'Workspace') id: string,
    @ZBody(updateWorkspaceSchema) body: UpdateWorkspaceRequest,
  ): Promise<WorkspaceDto> {
    return this.workspaces.update(user.userId, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a workspace and all its boards (OWNER)' })
  async remove(@CurrentUser() user: AuthInfo, @IdParam('id', 'Workspace') id: string): Promise<OkResponse> {
    await this.workspaces.remove(user.userId, id);
    return { ok: true };
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Workspace members' })
  members(@CurrentUser() user: AuthInfo, @IdParam('id', 'Workspace') id: string): Promise<WorkspaceMemberDto[]> {
    return this.workspaces.members(user.userId, id);
  }

  @Patch(':id/members/:userId')
  @ApiZodBody(updateMemberRoleSchema)
  @ApiOperation({ summary: 'Change a member role (ADMIN+; only owners grant OWNER)' })
  updateMember(
    @CurrentUser() user: AuthInfo,
    @IdParam('id', 'Workspace') id: string,
    @IdParam('userId', 'Member') targetUserId: string,
    @ZBody(updateMemberRoleSchema) body: UpdateMemberRoleRequest,
  ): Promise<WorkspaceMemberDto> {
    return this.workspaces.updateMemberRole(user.userId, id, targetUserId, body);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member (ADMIN+) or leave (self)' })
  async removeMember(
    @CurrentUser() user: AuthInfo,
    @IdParam('id', 'Workspace') id: string,
    @IdParam('userId', 'Member') targetUserId: string,
  ): Promise<OkResponse> {
    await this.workspaces.removeMember(user.userId, id, targetUserId);
    return { ok: true };
  }

  @Get(':id/invitations')
  @ApiOperation({ summary: 'Pending invitations (ADMIN+)' })
  invitations(@CurrentUser() user: AuthInfo, @IdParam('id', 'Workspace') id: string): Promise<WorkspaceInvitationDto[]> {
    return this.workspaces.invitations(user.userId, id);
  }

  @Post(':id/invitations')
  @ApiZodBody(inviteMemberSchema)
  @ApiOperation({ summary: 'Invite by email (ADMIN+)' })
  invite(
    @CurrentUser() user: AuthInfo,
    @IdParam('id', 'Workspace') id: string,
    @ZBody(inviteMemberSchema) body: InviteMemberRequest,
  ): Promise<InviteMemberResponse> {
    return this.workspaces.invite(user.userId, id, body);
  }

  @Delete(':id/invitations/:invitationId')
  @ApiOperation({ summary: 'Revoke an invitation (ADMIN+)' })
  async revokeInvitation(
    @CurrentUser() user: AuthInfo,
    @IdParam('id', 'Workspace') id: string,
    @IdParam('invitationId', 'Invitation') invitationId: string,
  ): Promise<OkResponse> {
    await this.workspaces.revokeInvitation(user.userId, id, invitationId);
    return { ok: true };
  }
}

@ApiTags('workspaces')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'Preview an invitation' })
  preview(@Param('token') token: string): Promise<InvitationPreviewDto> {
    return this.workspaces.preview(token);
  }

  @Post(':token/accept')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Accept an invitation (email must match)' })
  accept(@CurrentUser() user: AuthInfo, @Param('token') token: string): Promise<WorkspaceDto> {
    return this.workspaces.accept(user.userId, token);
  }
}
