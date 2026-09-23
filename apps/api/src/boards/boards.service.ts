import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@inkflow/database';
import type { SceneElement } from '@inkflow/elements';
import { duplicateElements, parseDocument, sanitizeAppState, type DocumentAppState } from '@inkflow/scene';
import {
  boardRoleAtLeast,
  isUuid,
  type BoardDetailDto,
  type BoardSummaryDto,
  type BoardRole,
  type CreateBoardRequest,
  type listBoardsQuerySchema,
  type UpdateBoardRequest,
} from '@inkflow/shared';
import type { z } from 'zod';
import { AccessService } from '../access/access.service';
import { RealtimeService } from '../collaboration/realtime.service';
import { Errors } from '../common/errors';
import type { Principal } from '../common/request';
import { BoardDocumentService, hasNulChar, imageFileId, toSerializedDocument } from '../documents/board-document.service';
import { FilesService, imageError } from '../files/files.service';
import { validateImage } from '../files/image-validation';
import { PurgeService } from '../files/purge.service';
import { PrismaService, type Db } from '../prisma/prisma.service';
import { StorageService, type StoredObject } from '../storage/storage.service';
import { TemplatesService } from '../templates/templates.service';
import {
  accessibleBoardsWhere,
  manageableBoardsWhere,
  ownRoleOf,
  summaryInclude,
  toBoardSummary,
  type BoardWithSummary,
} from './board-mappers';

export type ListBoardsParams = z.output<typeof listBoardsQuerySchema>;
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const LONG_TX = { timeout: 120_000, maxWait: 10_000 } as const;

interface InitialContent {
  elements: SceneElement[];
  appState: DocumentAppState;
  /** Board whose files image elements may reference (duplicates/imports from an accessible board). */
  sourceFiles: { boardId: string; fileIds: string[] }[];
}

@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly documents: BoardDocumentService,
    private readonly realtime: RealtimeService,
    private readonly templates: TemplatesService,
    private readonly files: FilesService,
    private readonly purge: PurgeService,
    private readonly storage: StorageService,
  ) {}

  async summary(boardId: string, userId: string | null, role: BoardRole): Promise<BoardSummaryDto> {
    const board = (await this.prisma.board.findUniqueOrThrow({
      where: { id: boardId },
      include: summaryInclude(userId),
    })) as BoardWithSummary;
    return toBoardSummary(board, role);
  }

  // ───────────── listing ─────────────

  async list(userId: string, query: ListBoardsParams): Promise<BoardSummaryDto[]> {
    for (const [name, value] of [
      ['workspaceId', query.workspaceId],
      ['projectId', query.projectId],
      ['folderId', query.folderId],
    ] as const) {
      if (value !== undefined && !isUuid(value)) throw Errors.validation(`${name} must be a UUID`);
    }
    const scope: Prisma.BoardWhereInput = {
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.folderId ? { folderId: query.folderId } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const include = summaryInclude(userId);
    let boards: BoardWithSummary[];
    switch (query.filter) {
      case 'trash':
        boards = (await this.prisma.board.findMany({
          where: { AND: [scope, { deletedAt: { not: null } }, manageableBoardsWhere(userId)] },
          include,
          orderBy: { deletedAt: 'desc' },
          take: query.limit,
        })) as BoardWithSummary[];
        break;
      case 'shared':
        boards = (await this.prisma.board.findMany({
          where: { AND: [scope, { deletedAt: null, ownerId: { not: userId }, members: { some: { userId } } }] },
          include,
          orderBy: { updatedAt: 'desc' },
          take: query.limit,
        })) as BoardWithSummary[];
        break;
      case 'recent':
      case 'favorites': {
        const refs =
          query.filter === 'recent'
            ? await this.prisma.boardView.findMany({
                where: { userId, board: { deletedAt: null } },
                orderBy: { lastViewedAt: 'desc' },
                take: query.limit * 2,
                select: { boardId: true },
              })
            : await this.prisma.boardFavorite.findMany({
                where: { userId, board: { deletedAt: null } },
                orderBy: { createdAt: 'desc' },
                take: query.limit * 2,
                select: { boardId: true },
              });
        const order = new Map(refs.map((r, i) => [r.boardId, i]));
        const found = (await this.prisma.board.findMany({
          where: { AND: [scope, { id: { in: [...order.keys()] }, deletedAt: null }, accessibleBoardsWhere(userId)] },
          include,
        })) as BoardWithSummary[];
        boards = found.sort((a, b) => order.get(a.id)! - order.get(b.id)!).slice(0, query.limit);
        break;
      }
      default:
        boards = (await this.prisma.board.findMany({
          where: { AND: [scope, { deletedAt: null }, accessibleBoardsWhere(userId)] },
          include,
          orderBy: { updatedAt: 'desc' },
          take: query.limit,
        })) as BoardWithSummary[];
    }
    return boards.flatMap((b) => {
      const role = ownRoleOf(b, userId);
      return role ? [toBoardSummary(b, role)] : [];
    });
  }

  // ───────────── creation ─────────────

  private async validatePlacement(
    db: Db,
    workspaceId: string,
    projectId: string | null | undefined,
    folderId: string | null | undefined,
  ): Promise<{ projectId: string | null; folderId: string | null }> {
    let project = projectId ?? null;
    let folder = folderId ?? null;
    if (folder) {
      const f = isUuid(folder) ? await db.folder.findUnique({ where: { id: folder } }) : null;
      if (!f || f.workspaceId !== workspaceId) throw Errors.validation('Folder not found in this workspace');
      if (project && f.projectId && f.projectId !== project) throw Errors.validation('Folder belongs to another project');
      project = project ?? f.projectId;
      folder = f.id;
    }
    if (project) {
      const p = isUuid(project) ? await db.project.findUnique({ where: { id: project } }) : null;
      if (!p || p.workspaceId !== workspaceId) throw Errors.validation('Project not found in this workspace');
      project = p.id;
    }
    return { projectId: project, folderId: folder };
  }

  private async initialContent(userId: string, input: CreateBoardRequest): Promise<InitialContent> {
    if (input.templateId) {
      if (!isUuid(input.templateId)) throw Errors.notFound('Template');
      const template = await this.templates.findUsable(userId, input.templateId);
      const parsed = parseDocument(template.document).document;
      const { elements } = duplicateElements(parsed.elements.filter((e) => !e.isDeleted));
      return { elements, appState: parsed.appState, sourceFiles: [] };
    }
    if (input.document) {
      let parsed;
      try {
        parsed = parseDocument(input.document).document;
      } catch (err) {
        throw Errors.validation(`Invalid document: ${(err as Error).message}`);
      }
      const elements = parsed.elements.filter((e) => !e.isDeleted);
      if (elements.some((el) => hasNulChar(el))) throw Errors.validation('Document contains NUL characters');
      // Image elements may point at files of boards the user can open (copy/paste, duplicates).
      const fileIds = [...new Set(elements.map(imageFileId).filter((id): id is string => id !== null))];
      const sourceFiles: InitialContent['sourceFiles'] = [];
      if (fileIds.length > 0) {
        const rows = await this.prisma.file.findMany({ where: { id: { in: fileIds } }, select: { id: true, boardId: true } });
        const byBoard = new Map<string, string[]>();
        for (const r of rows) byBoard.set(r.boardId, [...(byBoard.get(r.boardId) ?? []), r.id]);
        for (const [boardId, ids] of byBoard) {
          if (await this.access.getBoardAccess(boardId, { userId, shareToken: null })) sourceFiles.push({ boardId, fileIds: ids });
        }
      }
      return { elements, appState: parsed.appState, sourceFiles };
    }
    return { elements: [], appState: sanitizeAppState({}), sourceFiles: [] };
  }

  /** Inserts a board with its initial elements (fresh file records for referenced images). */
  private async insertBoard(
    userId: string,
    data: { workspaceId: string; projectId: string | null; folderId: string | null; title: string },
    content: InitialContent,
  ): Promise<string> {
    const boardId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.board.create({
        data: {
          id: boardId,
          workspaceId: data.workspaceId,
          projectId: data.projectId,
          folderId: data.folderId,
          ownerId: userId,
          title: data.title,
          appState: content.appState as unknown as Prisma.InputJsonValue,
          elementCount: content.elements.length,
          lastVersionAt: new Date(),
        },
      });
      let elements = content.elements;
      const remap = new Map<string, string>();
      for (const source of content.sourceFiles) {
        const map = await this.files.cloneFiles(tx, source.boardId, boardId, source.fileIds, userId);
        for (const [from, to] of map) remap.set(from, to);
      }
      if (remap.size > 0) {
        elements = elements.map((el) => {
          const fid = imageFileId(el);
          return el.type === 'image' && fid && remap.has(fid) ? { ...el, fileId: remap.get(fid)! } : el;
        });
      }
      await this.documents.upsertElements(tx, boardId, elements, userId);
      await this.documents.syncFileReferences(tx, boardId, elements);
    }, LONG_TX);
    return boardId;
  }

  async create(userId: string, input: CreateBoardRequest): Promise<BoardSummaryDto> {
    await this.access.requireWorkspace(input.workspaceId, userId);
    const placement = await this.validatePlacement(this.prisma, input.workspaceId, input.projectId, input.folderId);
    const content = await this.initialContent(userId, input);
    const boardId = await this.insertBoard(
      userId,
      { workspaceId: input.workspaceId, ...placement, title: input.title ?? 'Untitled board' },
      content,
    );
    return this.summary(boardId, userId, 'OWNER');
  }

  // ───────────── reading ─────────────

  async detail(principal: Principal, boardId: string): Promise<BoardDetailDto> {
    const access = await this.access.requireBoard(boardId, principal, 'VIEWER');
    const { document, seq } = await this.prisma.$transaction(
      async (tx) => {
        const snapshot = await this.documents.snapshot(tx, boardId);
        return { document: snapshot.document, seq: snapshot.seq };
      },
      { isolationLevel: 'RepeatableRead', timeout: 60_000 },
    );
    if (principal.userId) {
      const now = new Date();
      await this.prisma.boardView.upsert({
        where: { userId_boardId: { userId: principal.userId, boardId } },
        create: { userId: principal.userId, boardId, lastViewedAt: now },
        update: { lastViewedAt: now, viewCount: { increment: 1 } },
      });
    }
    return {
      board: await this.summary(boardId, access.userId, access.role),
      document: toSerializedDocument(document),
      seq,
      viaShareLink: access.viaShareLink,
    };
  }

  // ───────────── updates ─────────────

  async update(principal: Principal, boardId: string, input: UpdateBoardRequest): Promise<BoardSummaryDto> {
    const needsOwner = input.workspaceAccess !== undefined;
    const access = await this.access.requireBoard(boardId, principal, needsOwner ? 'OWNER' : 'EDITOR');
    const board = access.board;
    const data: Prisma.BoardUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.workspaceAccess !== undefined) data.workspaceAccess = input.workspaceAccess;
    if (input.projectId !== undefined || input.folderId !== undefined) {
      if (!access.userId || !access.workspaceRole) throw Errors.forbidden('Only workspace members can move boards');
      const placement = await this.validatePlacement(
        this.prisma,
        board.workspaceId,
        input.projectId !== undefined ? input.projectId : input.folderId !== undefined ? null : board.projectId,
        input.folderId !== undefined ? input.folderId : input.projectId !== undefined ? null : board.folderId,
      );
      data.projectId = placement.projectId;
      data.folderId = placement.folderId;
    }
    if (input.appState !== undefined) {
      const current = board.appState && typeof board.appState === 'object' ? (board.appState as Record<string, unknown>) : {};
      data.appState = sanitizeAppState({ ...current, ...input.appState }) as unknown as Prisma.InputJsonValue;
    }
    await this.prisma.board.update({ where: { id: boardId }, data });
    if (input.title !== undefined && input.title !== board.title) {
      await this.realtime.emitEvent(boardId, { kind: 'board-renamed', title: input.title });
    }
    if (input.workspaceAccess !== undefined && input.workspaceAccess !== board.workspaceAccess) {
      await this.realtime.emitEvent(boardId, { kind: 'permissions-changed' });
    }
    const fresh = await this.access.requireBoard(boardId, principal, 'VIEWER').catch(() => null);
    return this.summary(boardId, access.userId, fresh?.role ?? access.role);
  }

  async softDelete(principal: Principal, boardId: string): Promise<void> {
    const access = await this.access.requireBoard(boardId, principal, 'VIEWER');
    if (!boardRoleAtLeast(access.ownRole, 'OWNER')) throw Errors.forbidden('Only the board owner or a workspace admin can delete it');
    await this.prisma.board.update({ where: { id: boardId }, data: { deletedAt: new Date(), deletedById: access.userId } });
    await this.realtime.emitEvent(boardId, { kind: 'board-deleted' });
  }

  async restore(userId: string, boardId: string): Promise<BoardSummaryDto> {
    const access = await this.access.requireBoard(boardId, { userId, shareToken: null }, 'OWNER', { includeDeleted: true });
    if (!access.board.deletedAt) throw Errors.conflict('The board is not in the trash');
    await this.prisma.board.update({ where: { id: boardId }, data: { deletedAt: null, deletedById: null } });
    return this.summary(boardId, userId, access.role);
  }

  async permanentDelete(userId: string, boardId: string): Promise<void> {
    const access = await this.access.requireBoard(boardId, { userId, shareToken: null }, 'OWNER', { includeDeleted: true });
    if (!access.board.deletedAt) throw Errors.conflict('Move the board to the trash before deleting it permanently');
    await this.purge.purgeBoards([boardId]);
  }

  async emptyTrash(userId: string, workspaceId: string): Promise<number> {
    await this.access.requireWorkspace(workspaceId, userId);
    const boards = await this.prisma.board.findMany({
      where: { AND: [{ workspaceId, deletedAt: { not: null } }, manageableBoardsWhere(userId)] },
      select: { id: true },
    });
    return this.purge.purgeBoards(boards.map((b) => b.id));
  }

  async duplicate(userId: string, boardId: string): Promise<BoardSummaryDto> {
    const access = await this.access.requireBoard(boardId, { userId, shareToken: null }, 'VIEWER');
    const source = access.board;
    let target = { workspaceId: source.workspaceId, projectId: source.projectId, folderId: source.folderId };
    if (!access.workspaceRole) {
      const own = await this.prisma.workspaceMember.findFirst({
        where: { userId, role: 'OWNER' },
        orderBy: { createdAt: 'asc' },
        select: { workspaceId: true },
      });
      if (!own) throw Errors.forbidden('You need a workspace to duplicate boards into');
      target = { workspaceId: own.workspaceId, projectId: null, folderId: null };
    }
    const elements = await this.documents.loadElements(this.prisma, boardId);
    const fileIds = [...new Set(elements.map(imageFileId).filter((id): id is string => id !== null))];
    const newId = await this.insertBoard(
      userId,
      { ...target, title: `${source.title} (copy)`.slice(0, 200) },
      {
        elements,
        appState: sanitizeAppState(source.appState),
        sourceFiles: fileIds.length > 0 ? [{ boardId, fileIds }] : [],
      },
    );
    return this.summary(newId, userId, 'OWNER');
  }

  // ───────────── favorites ─────────────

  async setFavorite(userId: string, boardId: string, favorite: boolean): Promise<void> {
    await this.access.requireBoard(boardId, { userId, shareToken: null }, 'VIEWER');
    if (favorite) {
      await this.prisma.boardFavorite.upsert({
        where: { userId_boardId: { userId, boardId } },
        create: { userId, boardId },
        update: {},
      });
    } else {
      await this.prisma.boardFavorite.deleteMany({ where: { userId, boardId } });
    }
  }

  // ───────────── thumbnails ─────────────

  async setThumbnail(principal: Principal, boardId: string, buffer: Buffer, declaredMime: string | null): Promise<void> {
    const access = await this.access.requireBoard(boardId, principal, 'EDITOR');
    if (buffer.length > MAX_THUMBNAIL_BYTES) throw Errors.payloadTooLarge('Thumbnails may be at most 2 MB');
    let image;
    try {
      image = validateImage(buffer, declaredMime, ['image/png', 'image/webp']);
    } catch (err) {
      imageError(err);
    }
    const ext = image.mimeType === 'image/png' ? 'png' : 'webp';
    const key = `thumbnails/${boardId}/${randomUUID()}.${ext}`;
    await this.storage.put(key, buffer, image.mimeType);
    // Thumbnails change often: do not bump `updated_at` (it drives "last edited" ordering).
    await this.prisma.$executeRaw`UPDATE boards SET thumbnail_key = ${key} WHERE id = ${boardId}::uuid`;
    const previous = access.board.thumbnailKey;
    if (previous && previous !== key) await this.storage.deleteMany([previous]);
  }

  async thumbnail(principal: Principal, boardId: string): Promise<{ object: StoredObject; mimeType: string }> {
    const access = await this.access.requireBoard(boardId, principal, 'VIEWER');
    const key = access.board.thumbnailKey;
    const object = key ? await this.storage.get(key) : null;
    if (!key || !object) throw Errors.notFound('Thumbnail');
    return { object, mimeType: key.endsWith('.png') ? 'image/png' : 'image/webp' };
  }
}
