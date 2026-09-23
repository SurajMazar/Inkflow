import { Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addBoardShareSchema,
  createShareLinkSchema,
  updateBoardMemberSchema,
  type AddBoardShareRequest,
  type BoardSharingDto,
  type CreateShareLinkRequest,
  type OkResponse,
  type ResolvedShareLinkDto,
  type ShareLinkDto,
  type UpdateBoardMemberRequest,
} from '@inkflow/shared';
import { AllowShareToken, CurrentPrincipal, Public, type Principal } from '../common/request';
import { ApiZodBody, IdParam, ZBody } from '../common/validation';
import { SharingService } from './sharing.service';

@ApiTags('sharing')
@Controller()
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @AllowShareToken()
  @Get('boards/:id/sharing')
  @ApiOperation({ summary: 'Members, pending invitations and links (EDITOR+)' })
  get(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
  ): Promise<BoardSharingDto> {
    return this.sharing.get(principal, boardId);
  }

  @AllowShareToken()
  @Post('boards/:id/shares')
  @ApiZodBody(addBoardShareSchema)
  @ApiOperation({ summary: 'Share with an email address (EDITOR+, up to your own role)' })
  share(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @ZBody(addBoardShareSchema) body: AddBoardShareRequest,
  ): Promise<BoardSharingDto> {
    return this.sharing.share(principal, boardId, body);
  }

  @Patch('boards/:id/members/:userId')
  @ApiZodBody(updateBoardMemberSchema)
  @ApiOperation({ summary: "Change a member's role (OWNER)" })
  updateMember(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @IdParam('userId', 'Member') userId: string,
    @ZBody(updateBoardMemberSchema) body: UpdateBoardMemberRequest,
  ): Promise<BoardSharingDto> {
    return this.sharing.updateMember(principal, boardId, userId, body);
  }

  @Delete('boards/:id/members/:userId')
  @ApiOperation({ summary: 'Remove a member (OWNER) or leave (self)' })
  removeMember(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @IdParam('userId', 'Member') userId: string,
  ): Promise<BoardSharingDto> {
    return this.sharing.removeMember(principal, boardId, userId);
  }

  @AllowShareToken()
  @Delete('boards/:id/shares/:shareId')
  @ApiOperation({ summary: 'Revoke a pending email invitation' })
  revokeShare(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @IdParam('shareId', 'Share') shareId: string,
  ): Promise<BoardSharingDto> {
    return this.sharing.revokeShare(principal, boardId, shareId);
  }

  @AllowShareToken()
  @Post('boards/:id/share-links')
  @ApiZodBody(createShareLinkSchema)
  @ApiOperation({ summary: 'Create a share link (EDITOR+)' })
  createLink(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @ZBody(createShareLinkSchema) body: CreateShareLinkRequest,
  ): Promise<ShareLinkDto> {
    return this.sharing.createLink(principal, boardId, body);
  }

  @AllowShareToken()
  @Delete('boards/:id/share-links/:linkId')
  @ApiOperation({ summary: 'Revoke a share link' })
  async revokeLink(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @IdParam('linkId', 'Share link') linkId: string,
  ): Promise<OkResponse> {
    await this.sharing.revokeLink(principal, boardId, linkId);
    return { ok: true };
  }

  @Public()
  @Get('share-links/:token')
  @ApiOperation({ summary: 'Resolve a share link token' })
  resolve(@Param('token') token: string): Promise<ResolvedShareLinkDto> {
    return this.sharing.resolve(token);
  }
}
