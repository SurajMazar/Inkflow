import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  createBoardSchema,
  listBoardsQuerySchema,
  updateBoardSchema,
  type BoardDetailDto,
  type BoardSummaryDto,
  type CreateBoardRequest,
  type OkResponse,
  type UpdateBoardRequest,
} from '@inkflow/shared';
import { z } from 'zod';
import { Errors } from '../common/errors';
import { AllowShareToken, CurrentPrincipal, CurrentUser, type AuthInfo, type Principal } from '../common/request';
import { ApiZodBody, ApiZodQuery, IdParam, ZBody, ZQuery } from '../common/validation';
import { BoardsService, MAX_THUMBNAIL_BYTES, type ListBoardsParams } from './boards.service';

const emptyTrashSchema = z.object({ workspaceId: z.uuid() });

@ApiTags('boards')
@ApiCookieAuth()
@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  @ApiZodQuery(listBoardsQuerySchema)
  @ApiOperation({ summary: 'List boards (filter: all | recent | favorites | shared | trash)' })
  list(@CurrentUser() user: AuthInfo, @ZQuery(listBoardsQuerySchema) query: ListBoardsParams): Promise<BoardSummaryDto[]> {
    return this.boards.list(user.userId, query);
  }

  @Post()
  @ApiZodBody(createBoardSchema)
  @ApiOperation({ summary: 'Create a board (optionally from a template or document)' })
  create(@CurrentUser() user: AuthInfo, @ZBody(createBoardSchema) body: CreateBoardRequest): Promise<BoardSummaryDto> {
    return this.boards.create(user.userId, body);
  }

  @Post('trash/empty')
  @HttpCode(200)
  @ApiZodBody(emptyTrashSchema)
  @ApiOperation({ summary: 'Permanently delete the boards in a workspace trash that you manage' })
  async emptyTrash(
    @CurrentUser() user: AuthInfo,
    @ZBody(emptyTrashSchema) body: z.output<typeof emptyTrashSchema>,
  ): Promise<{ deleted: number }> {
    return { deleted: await this.boards.emptyTrash(user.userId, body.workspaceId) };
  }

  @AllowShareToken()
  @Get(':id')
  @ApiOperation({ summary: 'Board with its document (records "recently viewed")' })
  detail(@CurrentPrincipal() principal: Principal, @IdParam('id', 'Board') id: string): Promise<BoardDetailDto> {
    return this.boards.detail(principal, id);
  }

  @AllowShareToken()
  @Patch(':id')
  @ApiZodBody(updateBoardSchema)
  @ApiOperation({ summary: 'Rename / move / change settings (EDITOR+; workspaceAccess needs OWNER)' })
  update(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') id: string,
    @ZBody(updateBoardSchema) body: UpdateBoardRequest,
  ): Promise<BoardSummaryDto> {
    return this.boards.update(principal, id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Move a board to the trash (OWNER or workspace ADMIN)' })
  async remove(@CurrentPrincipal() principal: Principal, @IdParam('id', 'Board') id: string): Promise<OkResponse> {
    await this.boards.softDelete({ userId: principal.userId, shareToken: null }, id);
    return { ok: true };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore a board from the trash' })
  restore(@CurrentUser() user: AuthInfo, @IdParam('id', 'Board') id: string): Promise<BoardSummaryDto> {
    return this.boards.restore(user.userId, id);
  }

  @Delete(':id/permanent')
  @ApiOperation({ summary: 'Permanently delete a board that is in the trash' })
  async permanent(@CurrentUser() user: AuthInfo, @IdParam('id', 'Board') id: string): Promise<OkResponse> {
    await this.boards.permanentDelete(user.userId, id);
    return { ok: true };
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate a board' })
  duplicate(@CurrentUser() user: AuthInfo, @IdParam('id', 'Board') id: string): Promise<BoardSummaryDto> {
    return this.boards.duplicate(user.userId, id);
  }

  @Put(':id/favorite')
  @ApiOperation({ summary: 'Add to favorites' })
  async favorite(@CurrentUser() user: AuthInfo, @IdParam('id', 'Board') id: string): Promise<OkResponse> {
    await this.boards.setFavorite(user.userId, id, true);
    return { ok: true };
  }

  @Delete(':id/favorite')
  @ApiOperation({ summary: 'Remove from favorites' })
  async unfavorite(@CurrentUser() user: AuthInfo, @IdParam('id', 'Board') id: string): Promise<OkResponse> {
    await this.boards.setFavorite(user.userId, id, false);
    return { ok: true };
  }

  @AllowShareToken()
  @Put(':id/thumbnail')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_THUMBNAIL_BYTES, files: 1, fields: 5 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload the board thumbnail (png/webp ≤ 2 MB, EDITOR+)' })
  async setThumbnail(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<OkResponse> {
    if (!file) throw Errors.validation('A file is required', [{ path: ['file'], message: 'Required', code: 'invalid_type' }]);
    await this.boards.setThumbnail(principal, id, file.buffer, file.mimetype ?? null);
    return { ok: true };
  }

  @AllowShareToken()
  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Board thumbnail image' })
  async thumbnail(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'Board') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { object, mimeType } = await this.boards.thumbnail(principal, id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(object.body, { type: mimeType, ...(object.contentLength ? { length: object.contentLength } : {}) });
  }
}
