import { Injectable } from '@nestjs/common';
import type { File as FileRow } from '@inkflow/database';
import type { FileMetadata, SceneElement } from '@inkflow/elements';
import { sanitizeAppState, serializeDocument, type SceneDocument } from '@inkflow/scene';
import { isUuid, type SerializedDocument } from '@inkflow/shared';
import { PrismaService, type Db } from '../prisma/prisma.service';
import { extractSearchText } from './search-text';

export interface BoardSnapshot {
  document: SceneDocument;
  seq: number;
  elementCount: number;
}

/** Rows written per statement when bulk-inserting elements. */
const INSERT_CHUNK = 1_000;

export function fileContentUrl(fileId: string): string {
  return `/api/files/${fileId}/content`;
}

export function toFileMetadata(file: Pick<FileRow, 'id' | 'mimeType' | 'width' | 'height' | 'size' | 'createdAt'>): FileMetadata {
  return {
    id: file.id,
    mimeType: file.mimeType,
    url: fileContentUrl(file.id),
    width: file.width ?? 0,
    height: file.height ?? 0,
    size: file.size,
    created: file.createdAt.getTime(),
  };
}

export function toSerializedDocument(doc: SceneDocument): SerializedDocument {
  return {
    version: doc.version,
    elements: doc.elements,
    appState: { ...doc.appState } as Record<string, unknown>,
    files: { ...doc.files } as Record<string, unknown>,
  };
}

/** True when any string inside `value` contains a NUL character (PostgreSQL text/jsonb reject it). */
export function hasNulChar(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some((v) => hasNulChar(v, depth + 1));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (k.includes('\u0000') || hasNulChar(v, depth + 1)) return true;
  }
  return false;
}

/** The file id referenced by an image element, when it can name a stored file. */
export function imageFileId(el: SceneElement): string | null {
  if (el.type !== 'image' || !el.fileId) return null;
  return isUuid(el.fileId) ? el.fileId.toLowerCase() : null;
}

/** Element state persistence helpers shared by boards, operations and versions. */
@Injectable()
export class BoardDocumentService {
  constructor(readonly prisma: PrismaService) {}

  /** Elements of a board in z-order (`z_index COLLATE "C", element_id`). */
  async loadElements(db: Db, boardId: string, options: { includeDeleted?: boolean } = {}): Promise<SceneElement[]> {
    const rows = options.includeDeleted
      ? await db.$queryRaw<{ data: SceneElement }[]>`
          SELECT data FROM board_elements WHERE board_id = ${boardId}::uuid
          ORDER BY z_index COLLATE "C", element_id`
      : await db.$queryRaw<{ data: SceneElement }[]>`
          SELECT data FROM board_elements WHERE board_id = ${boardId}::uuid AND is_deleted = false
          ORDER BY z_index COLLATE "C", element_id`;
    return rows.map((r) => r.data);
  }

  /** Metadata of the (existing) files referenced by the board's elements. */
  async referencedFiles(db: Db, boardId: string): Promise<Record<string, FileMetadata>> {
    const files = await db.file.findMany({
      where: { boardId, references: { some: { boardId } } },
      select: { id: true, mimeType: true, width: true, height: true, size: true, createdAt: true },
    });
    return Object.fromEntries(files.map((f) => [f.id, toFileMetadata(f)]));
  }

  async snapshot(db: Db, boardId: string): Promise<BoardSnapshot> {
    const board = await db.board.findUniqueOrThrow({ where: { id: boardId }, select: { appState: true, seq: true } });
    const elements = await this.loadElements(db, boardId);
    const files = await this.referencedFiles(db, boardId);
    const document = serializeDocument(elements, sanitizeAppState(board.appState), files);
    return { document, seq: Number(board.seq), elementCount: document.elements.length };
  }

  /** Upserts final element states (bulk). */
  async upsertElements(db: Db, boardId: string, elements: SceneElement[], userId: string | null): Promise<void> {
    for (let i = 0; i < elements.length; i += INSERT_CHUNK) {
      const rows = elements.slice(i, i + INSERT_CHUNK).map((el) => ({
        element_id: el.id,
        type: el.type,
        data: el,
        version: el.version,
        z_index: el.index,
        is_deleted: el.isDeleted,
        search_text: el.isDeleted ? '' : extractSearchText(el),
      }));
      const payload = JSON.stringify(rows);
      await db.$executeRaw`
        INSERT INTO board_elements
          (board_id, element_id, type, data, version, z_index, is_deleted, search_text, updated_by, created_at, updated_at)
        SELECT ${boardId}::uuid, r.element_id, r.type, r.data, r.version, r.z_index, r.is_deleted, r.search_text,
               ${userId}::uuid, now(), now()
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS r(element_id text, type text, data jsonb, version int, z_index text, is_deleted boolean, search_text text)
        ON CONFLICT (board_id, element_id) DO UPDATE SET
          type = EXCLUDED.type,
          data = EXCLUDED.data,
          version = EXCLUDED.version,
          z_index = EXCLUDED.z_index,
          is_deleted = EXCLUDED.is_deleted,
          search_text = EXCLUDED.search_text,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()`;
    }
  }

  /**
   * Re-derives `file_references` for the given image elements (final states): a live image element
   * references its file when that file exists and belongs to the same board.
   */
  async syncFileReferences(db: Db, boardId: string, elements: SceneElement[]): Promise<void> {
    const images = elements.filter((el) => el.type === 'image');
    if (images.length === 0) return;
    await db.fileReference.deleteMany({ where: { boardId, elementId: { in: images.map((el) => el.id) } } });
    const wanted = images
      .filter((el) => !el.isDeleted)
      .map((el) => ({ elementId: el.id, fileId: imageFileId(el) }))
      .filter((r): r is { elementId: string; fileId: string } => r.fileId !== null);
    if (wanted.length === 0) return;
    const existing = await db.file.findMany({
      where: { id: { in: [...new Set(wanted.map((w) => w.fileId))] }, boardId },
      select: { id: true },
    });
    const ok = new Set(existing.map((f) => f.id));
    const data = wanted.filter((w) => ok.has(w.fileId)).map((w) => ({ boardId, elementId: w.elementId, fileId: w.fileId }));
    if (data.length > 0) await db.fileReference.createMany({ data, skipDuplicates: true });
  }

  /** Rebuilds all file references of a board from its current elements. */
  async rebuildFileReferences(db: Db, boardId: string): Promise<void> {
    await db.fileReference.deleteMany({ where: { boardId } });
    const rows = await db.$queryRaw<{ data: SceneElement }[]>`
      SELECT data FROM board_elements WHERE board_id = ${boardId}::uuid AND type = 'image' AND is_deleted = false`;
    await this.syncFileReferences(
      db,
      boardId,
      rows.map((r) => r.data),
    );
  }

  /** Creates references for live image elements of a board that point at a newly uploaded file. */
  async linkUploadedFile(db: Db, boardId: string, fileId: string): Promise<void> {
    await db.$executeRaw`
      INSERT INTO file_references (id, file_id, board_id, element_id, created_at, updated_at)
      SELECT gen_random_uuid(), ${fileId}::uuid, ${boardId}::uuid, e.element_id, now(), now()
      FROM board_elements e
      WHERE e.board_id = ${boardId}::uuid AND e.type = 'image' AND e.is_deleted = false
        AND lower(e.data->>'fileId') = ${fileId.toLowerCase()}
      ON CONFLICT (board_id, element_id) DO UPDATE SET file_id = EXCLUDED.file_id, updated_at = now()`;
  }
}
