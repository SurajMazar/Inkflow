import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type File as FileRow } from '@inkflow/database';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  isUuid,
  type AllowedImageMimeType,
  type FileDto,
} from '@inkflow/shared';
import { AccessService } from '../access/access.service';
import { sha256Hex } from '../common/crypto';
import { Errors } from '../common/errors';
import { iso } from '../common/mappers';
import type { Principal } from '../common/request';
import { BoardDocumentService, fileContentUrl } from '../documents/board-document.service';
import { PrismaService, type Db } from '../prisma/prisma.service';
import { StorageService, type StoredObject } from '../storage/storage.service';
import { ImageValidationError, validateImage } from './image-validation';

export interface UploadInput {
  boardId: string;
  fileId?: string | null;
  buffer: Buffer;
  originalName: string;
  declaredMime: string | null;
}

export function storageKeyFor(sha256: string): string {
  return `files/${sha256}`;
}

export function toFileDto(file: FileRow): FileDto {
  return {
    id: file.id,
    boardId: file.boardId,
    mimeType: file.mimeType as AllowedImageMimeType,
    size: file.size,
    width: file.width,
    height: file.height,
    originalName: file.originalName,
    url: fileContentUrl(file.id),
    createdAt: iso(file.createdAt),
  };
}

/** Converts validation failures into API errors. */
export function imageError(err: unknown): never {
  if (err instanceof ImageValidationError) throw Errors.unsupportedMediaType(err.message);
  throw err;
}

export function sanitizeFileName(name: string | undefined | null): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'image';
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly documents: BoardDocumentService,
  ) {}

  async upload(principal: Principal, input: UploadInput): Promise<FileDto> {
    if (!isUuid(input.boardId)) throw Errors.notFound('Board');
    if (
      input.fileId !== undefined &&
      input.fileId !== null &&
      input.fileId !== '' &&
      !isUuid(input.fileId)
    ) {
      throw Errors.validation('fileId must be a UUID', [
        { path: ['fileId'], message: 'Invalid UUID', code: 'invalid_format' },
      ]);
    }
    const requestedId = input.fileId ? input.fileId.toLowerCase() : null;
    await this.access.requireBoard(input.boardId, principal, 'EDITOR');

    let image;
    try {
      image = validateImage(input.buffer, input.declaredMime, ALLOWED_IMAGE_MIME_TYPES);
    } catch (err) {
      imageError(err);
    }
    const sha256 = sha256Hex(input.buffer);

    if (requestedId) {
      const existing = await this.prisma.file.findUnique({ where: { id: requestedId } });
      if (existing) return this.idempotentResult(existing, input.boardId, sha256);
    } else {
      const same = await this.prisma.file.findFirst({ where: { boardId: input.boardId, sha256 } });
      if (same) return toFileDto(same);
    }

    const storageKey = storageKeyFor(sha256);
    await this.storage.put(storageKey, input.buffer, image.mimeType);
    let file: FileRow;
    try {
      file = await this.prisma.file.create({
        data: {
          ...(requestedId ? { id: requestedId } : {}),
          boardId: input.boardId,
          uploadedById: principal.userId,
          storageKey,
          sha256,
          mimeType: image.mimeType,
          size: input.buffer.length,
          width: image.width,
          height: image.height,
          originalName: sanitizeFileName(input.originalName),
        },
      });
    } catch (err) {
      // Concurrent retry of the same client-generated id.
      if (
        requestedId &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.file.findUnique({ where: { id: requestedId } });
        if (existing) return this.idempotentResult(existing, input.boardId, sha256);
      }
      throw err;
    }
    // Image elements that were created before the upload finished now get their reference.
    await this.documents.linkUploadedFile(this.prisma, input.boardId, file.id);
    return toFileDto(file);
  }

  private idempotentResult(existing: FileRow, boardId: string, sha256: string): FileDto {
    if (existing.boardId !== boardId || existing.sha256 !== sha256) {
      throw Errors.conflict('A different file with this id already exists');
    }
    return toFileDto(existing);
  }

  private async findAccessible(principal: Principal, fileId: string): Promise<FileRow> {
    const file = isUuid(fileId)
      ? await this.prisma.file.findUnique({ where: { id: fileId } })
      : null;
    if (!file) throw Errors.notFound('File');
    const access = await this.access.getBoardAccess(file.boardId, principal);
    if (!access) throw Errors.notFound('File');
    return file;
  }

  async get(principal: Principal, fileId: string): Promise<FileDto> {
    return toFileDto(await this.findAccessible(principal, fileId));
  }

  async content(
    principal: Principal,
    fileId: string,
  ): Promise<{ file: FileRow; object: StoredObject }> {
    const file = await this.findAccessible(principal, fileId);
    const object = await this.storage.get(file.storageKey);
    if (!object) {
      this.logger.error(`Object ${file.storageKey} of file ${file.id} is missing from storage`);
      throw Errors.notFound('File content');
    }
    return { file, object };
  }

  /**
   * Copies file records of `fromBoardId` to `toBoardId` (objects are content-addressed and shared).
   * Returns old id → new id.
   */
  async cloneFiles(
    db: Db,
    fromBoardId: string,
    toBoardId: string,
    fileIds: string[],
    userId: string | null,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const ids = [...new Set(fileIds.filter((id) => isUuid(id)).map((id) => id.toLowerCase()))];
    if (ids.length === 0) return map;
    const files = await db.file.findMany({ where: { id: { in: ids }, boardId: fromBoardId } });
    for (const f of files) {
      const copy = await db.file.create({
        data: {
          boardId: toBoardId,
          uploadedById: userId ?? f.uploadedById,
          storageKey: f.storageKey,
          sha256: f.sha256,
          mimeType: f.mimeType,
          size: f.size,
          width: f.width,
          height: f.height,
          originalName: f.originalName,
        },
      });
      map.set(f.id, copy.id);
    }
    return map;
  }
}
