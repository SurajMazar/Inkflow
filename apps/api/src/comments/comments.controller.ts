import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createCommentSchema,
  createReplySchema,
  updateCommentSchema,
  type CommentDto,
  type CommentReplyDto,
  type OkResponse,
} from '@inkflow/shared';
import { z } from 'zod';
import { AllowShareToken, CurrentPrincipal, type Principal } from '../common/request';
import { ApiZodBody, ApiZodQuery, IdParam, ZBody, ZQuery } from '../common/validation';
import { CommentsService } from './comments.service';

const listSchema = z.object({
  includeResolved: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
});

@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @AllowShareToken()
  @Get('boards/:id/comments')
  @ApiZodQuery(listSchema)
  @ApiOperation({ summary: 'Comments of a board' })
  list(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @ZQuery(listSchema) query: z.output<typeof listSchema>,
  ): Promise<CommentDto[]> {
    return this.comments.list(principal, boardId, query.includeResolved);
  }

  @AllowShareToken()
  @Post('boards/:id/comments')
  @ApiZodBody(createCommentSchema)
  @ApiOperation({ summary: 'Add a comment (signed-in VIEWER+)' })
  create(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') boardId: string,
    @ZBody(createCommentSchema) body: z.output<typeof createCommentSchema>,
  ): Promise<CommentDto> {
    return this.comments.create(principal, boardId, body);
  }

  @AllowShareToken()
  @Patch('comments/:id')
  @ApiZodBody(updateCommentSchema)
  @ApiOperation({ summary: 'Edit a comment (author)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Comment') id: string,
    @ZBody(updateCommentSchema) body: z.output<typeof updateCommentSchema>,
  ): Promise<CommentDto> {
    return this.comments.update(principal, id, body);
  }

  @AllowShareToken()
  @Post('comments/:id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a comment thread' })
  resolve(@CurrentPrincipal() principal: Principal, @IdParam('id', 'Comment') id: string): Promise<CommentDto> {
    return this.comments.setResolved(principal, id, true);
  }

  @AllowShareToken()
  @Post('comments/:id/reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reopen a comment thread' })
  reopen(@CurrentPrincipal() principal: Principal, @IdParam('id', 'Comment') id: string): Promise<CommentDto> {
    return this.comments.setResolved(principal, id, false);
  }

  @AllowShareToken()
  @Delete('comments/:id')
  @ApiOperation({ summary: 'Delete a comment (author or board OWNER)' })
  async remove(@CurrentPrincipal() principal: Principal, @IdParam('id', 'Comment') id: string): Promise<OkResponse> {
    await this.comments.remove(principal, id);
    return { ok: true };
  }

  @AllowShareToken()
  @Post('comments/:id/replies')
  @ApiZodBody(createReplySchema)
  @ApiOperation({ summary: 'Reply to a comment' })
  reply(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Comment') id: string,
    @ZBody(createReplySchema) body: z.output<typeof createReplySchema>,
  ): Promise<CommentReplyDto> {
    return this.comments.reply(principal, id, body);
  }

  @AllowShareToken()
  @Patch('comment-replies/:id')
  @ApiZodBody(createReplySchema)
  @ApiOperation({ summary: 'Edit a reply (author)' })
  updateReply(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Reply') id: string,
    @ZBody(createReplySchema) body: z.output<typeof createReplySchema>,
  ): Promise<CommentReplyDto> {
    return this.comments.updateReply(principal, id, body);
  }

  @AllowShareToken()
  @Delete('comment-replies/:id')
  @ApiOperation({ summary: 'Delete a reply (author or board OWNER)' })
  async removeReply(@CurrentPrincipal() principal: Principal, @IdParam('id', 'Reply') id: string): Promise<OkResponse> {
    await this.comments.removeReply(principal, id);
    return { ok: true };
  }
}
