import { Body, Controller, Get, Post, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MAX_UPLOAD_BYTES, type FileDto } from '@inkflow/shared';
import { Errors } from '../common/errors';
import { AllowShareToken, CurrentPrincipal, type Principal } from '../common/request';
import { IdParam } from '../common/validation';
import { FilesService } from './files.service';

/** Headers for serving user-uploaded content: never sniffed, never scripted, cacheable per id. */
export const FILE_CONTENT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @AllowShareToken()
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, fieldSize: 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'boardId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        boardId: { type: 'string', format: 'uuid' },
        fileId: { type: 'string', format: 'uuid', description: 'Optional client-generated id (idempotent retries)' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload an image to a board (EDITOR+)' })
  upload(
    @CurrentPrincipal() principal: Principal,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown> | undefined,
  ): Promise<FileDto> {
    if (!file) throw Errors.validation('A file is required', [{ path: ['file'], message: 'Required', code: 'invalid_type' }]);
    const boardId = typeof body?.boardId === 'string' ? body.boardId : '';
    if (!boardId) throw Errors.validation('boardId is required', [{ path: ['boardId'], message: 'Required', code: 'invalid_type' }]);
    const fileId = typeof body?.fileId === 'string' ? body.fileId : null;
    return this.files.upload(principal, {
      boardId,
      fileId,
      buffer: file.buffer,
      originalName: file.originalname,
      declaredMime: file.mimetype ?? null,
    });
  }

  @AllowShareToken()
  @Get(':id')
  @ApiOperation({ summary: 'File metadata' })
  get(@CurrentPrincipal() principal: Principal, @IdParam('id', 'File') id: string): Promise<FileDto> {
    return this.files.get(principal, id);
  }

  @AllowShareToken()
  @Get(':id/content')
  @ApiOperation({ summary: 'File bytes (permission-checked; `st` query for share links)' })
  async content(
    @CurrentPrincipal() principal: Principal,
    @IdParam('id', 'File') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, object } = await this.files.content(principal, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', FILE_CONTENT_CSP);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', contentDisposition(file.originalName));
    return new StreamableFile(object.body, { type: file.mimeType, length: object.contentLength ?? file.size });
  }
}
