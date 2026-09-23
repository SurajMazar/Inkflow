import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Prisma, type BoardVersion, type VersionKind } from '@inkflow/database';
import type { SceneElement } from '@inkflow/elements';
import { parseDocument, sanitizeAppState, type SceneDocument } from '@inkflow/scene';
import { randomInteger, type BoardVersionDetailDto, type BoardVersionDto, type VersionComparisonDto } from '@inkflow/shared';
import { AccessService } from '../access/access.service';
import { RealtimeService } from '../collaboration/realtime.service';
import { AppConfig } from '../config/app-config';
import { Errors } from '../common/errors';
import { iso, publicUserSelect, toPublicUser, type PublicUserRow } from '../common/mappers';
import type { Principal } from '../common/request';
import { BoardDocumentService, toSerializedDocument } from '../documents/board-document.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type VersionSummaryRow = Omit<BoardVersion, 'snapshot'> & { createdBy: PublicUserRow | null };

const summarySelect = {
  id: true,
  boardId: true,
  number: true,
  label: true,
  kind: true,
  elementCount: true,
  seq: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: publicUserSelect },
} as const;

export function toVersionDto(v: VersionSummaryRow): BoardVersionDto {
  return {
    id: v.id,
    boardId: v.boardId,
    number: v.number,
    label: v.label,
    kind: v.kind,
    elementCount: v.elementCount,
    seq: Number(v.seq),
    createdBy: v.createdBy ? toPublicUser(v.createdBy) : null,
    createdAt: iso(v.createdAt),
  };
}

/** Content equality ignoring bookkeeping fields that change on every write. */
export function sameContent(a: SceneElement, b: SceneElement): boolean {
  const strip = (el: SceneElement) => {
    const { version: _v, versionNonce: _n, updated: _u, ...rest } = el;
    return rest;
  };
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Diff of live elements between two documents. */
export function compareDocuments(from: SceneDocument, to: SceneDocument): Omit<VersionComparisonDto, 'fromVersionId' | 'toVersionId'> {
  const a = new Map(from.elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const b = new Map(to.elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  let unchangedCount = 0;
  for (const [id, el] of b) {
    const before = a.get(id);
    if (!before) added.push(id);
    else if (sameContent(before, el)) unchangedCount++;
    else modified.push(id);
  }
  for (const id of a.keys()) if (!b.has(id)) removed.push(id);
  return { added, removed, modified, unchangedCount };
}

@Injectable()
export class VersionsService implements OnApplicationShutdown {
  private readonly logger = new Logger(VersionsService.name);
  private readonly inFlight = new Map<string, Promise<void>>();
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly documents: BoardDocumentService,
    private readonly realtime: RealtimeService,
    private readonly config: AppConfig,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.allSettled([...this.inFlight.values()]);
  }

  /** Inserts a version with the next number (caller holds the board row lock). */
  private async insertVersion(
    tx: Tx,
    boardId: string,
    kind: VersionKind,
    label: string | null,
    userId: string | null,
  ): Promise<string> {
    const snap = await this.documents.snapshot(tx, boardId);
    const next = await tx.boardVersion.aggregate({ where: { boardId }, _max: { number: true } });
    const version = await tx.boardVersion.create({
      data: {
        boardId,
        number: (next._max.number ?? 0) + 1,
        label,
        kind,
        snapshot: snap.document as unknown as Prisma.InputJsonValue,
        elementCount: snap.elementCount,
        seq: BigInt(snap.seq),
        createdById: userId,
      },
      select: { id: true },
    });
    await tx.$executeRaw`UPDATE boards SET ops_since_version = 0, last_version_at = now() WHERE id = ${boardId}::uuid`;
    return version.id;
  }

  private async lockBoard(tx: Tx, boardId: string): Promise<{ ops_since_version: number; last_version_at: Date | null; created_at: Date }> {
    const rows = await tx.$queryRaw<{ ops_since_version: number; last_version_at: Date | null; created_at: Date; deleted_at: Date | null }[]>`
      SELECT ops_since_version, last_version_at, created_at, deleted_at FROM boards WHERE id = ${boardId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row || row.deleted_at) throw Errors.notFound('Board');
    return row;
  }

  /** Runs a version-creating transaction, retrying on a concurrent number clash. */
  private async withVersionTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, { timeout: 60_000, maxWait: 10_000 });
      } catch (err) {
        if (attempt < 3 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
  }

  // ───────────── automatic versions ─────────────

  shouldAutoVersion(row: { ops_since_version: number; last_version_at: Date | null; created_at: Date }, now = Date.now()): boolean {
    if (row.ops_since_version <= 0) return false;
    if (row.ops_since_version >= this.config.env.AUTO_VERSION_EVERY_OPS) return true;
    const since = (row.last_version_at ?? row.created_at).getTime();
    return now - since >= this.config.env.AUTO_VERSION_EVERY_MINUTES * 60_000;
  }

  /** Checks (asynchronously, after commit) whether an automatic version is due. */
  scheduleAutoVersion(boardId: string): void {
    if (this.shuttingDown || this.inFlight.has(boardId)) return;
    const task = this.createAutoVersionIfDue(boardId)
      .then(() => undefined)
      .catch((err: Error) => this.logger.warn(`Automatic version of board ${boardId} failed: ${err.message}`))
      .finally(() => this.inFlight.delete(boardId));
    this.inFlight.set(boardId, task);
  }

  /** Creates an AUTO version when the thresholds are reached; safe under concurrency. */
  async createAutoVersionIfDue(boardId: string): Promise<string | null> {
    const quick = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: { opsSinceVersion: true, lastVersionAt: true, createdAt: true, deletedAt: true },
    });
    if (!quick || quick.deletedAt) return null;
    if (!this.shouldAutoVersion({ ops_since_version: quick.opsSinceVersion, last_version_at: quick.lastVersionAt, created_at: quick.createdAt })) {
      return null;
    }
    return this.withVersionTx(async (tx) => {
      const row = await this.lockBoard(tx, boardId);
      if (!this.shouldAutoVersion(row)) return null; // another instance was faster
      return this.insertVersion(tx, boardId, 'AUTO', null, null);
    });
  }

  /** Waits for pending automatic versions (tests / shutdown). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inFlight.values()]);
  }

  // ───────────── API ─────────────

  async list(principal: Principal, boardId: string): Promise<BoardVersionDto[]> {
    await this.access.requireBoard(boardId, principal, 'VIEWER');
    const rows = await this.prisma.boardVersion.findMany({
      where: { boardId },
      select: summarySelect,
      orderBy: { number: 'desc' },
      take: 500,
    });
    return rows.map(toVersionDto);
  }

  async create(principal: Principal, boardId: string, label: string | undefined): Promise<BoardVersionDto> {
    const access = await this.access.requireBoard(boardId, principal, 'EDITOR');
    const id = await this.withVersionTx(async (tx) => {
      await this.lockBoard(tx, boardId);
      return this.insertVersion(tx, boardId, 'MANUAL', label ?? null, access.userId);
    });
    return toVersionDto(await this.prisma.boardVersion.findUniqueOrThrow({ where: { id }, select: summarySelect }));
  }

  private async findVersion(boardId: string, versionId: string): Promise<BoardVersion & { createdBy: PublicUserRow | null }> {
    const version = await this.prisma.boardVersion.findFirst({
      where: { id: versionId, boardId },
      include: { createdBy: { select: publicUserSelect } },
    });
    if (!version) throw Errors.notFound('Version');
    return version;
  }

  private snapshotOf(version: BoardVersion): SceneDocument {
    return parseDocument(version.snapshot).document;
  }

  async get(principal: Principal, boardId: string, versionId: string): Promise<BoardVersionDetailDto> {
    await this.access.requireBoard(boardId, principal, 'VIEWER');
    const version = await this.findVersion(boardId, versionId);
    return { ...toVersionDto(version), document: toSerializedDocument(this.snapshotOf(version)) };
  }

  async compare(principal: Principal, boardId: string, versionId: string, to: string): Promise<VersionComparisonDto> {
    await this.access.requireBoard(boardId, principal, 'VIEWER');
    const from = this.snapshotOf(await this.findVersion(boardId, versionId));
    let target: SceneDocument;
    let toVersionId: string | 'current' = 'current';
    if (to === 'current') {
      target = (await this.documents.snapshot(this.prisma, boardId)).document;
    } else {
      const other = await this.findVersion(boardId, to);
      target = this.snapshotOf(other);
      toVersionId = other.id;
    }
    return { fromVersionId: versionId, toVersionId, ...compareDocuments(from, target) };
  }

  /**
   * Restores a version: backs up the current state (RESTORE_BACKUP), makes the board match the
   * snapshot (tombstones extra elements, upserts the rest with bumped versions, bumps seq), then asks
   * collaborators to resync. Returns the backup version.
   */
  async restore(principal: Principal, boardId: string, versionId: string): Promise<BoardVersionDto> {
    const access = await this.access.requireBoard(boardId, principal, 'EDITOR');
    const version = await this.findVersion(boardId, versionId);
    const snapshot = this.snapshotOf(version);
    const backupId = await this.withVersionTx(async (tx) => {
      await this.lockBoard(tx, boardId);
      const backup = await this.insertVersion(tx, boardId, 'RESTORE_BACKUP', `Before restoring version ${version.number}`, access.userId);
      const current = await this.documents.loadElements(tx, boardId, { includeDeleted: true });
      const currentById = new Map(current.map((el) => [el.id, el]));
      const target = new Map(snapshot.elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
      const now = Date.now();
      const writes: SceneElement[] = [];
      for (const el of current) {
        if (!el.isDeleted && !target.has(el.id)) {
          writes.push({ ...el, isDeleted: true, version: el.version + 1, versionNonce: randomInteger(), updated: now });
        }
      }
      for (const el of target.values()) {
        const existing = currentById.get(el.id);
        if (existing && !existing.isDeleted && sameContent(existing, el)) continue;
        const nextVersion = Math.max(existing?.version ?? 0, el.version) + 1;
        writes.push({ ...el, isDeleted: false, version: nextVersion, versionNonce: randomInteger(), updated: now });
      }
      const boardRow = await tx.board.findUniqueOrThrow({ where: { id: boardId }, select: { seq: true } });
      const seq = boardRow.seq + 1n;
      if (writes.length > 0) await this.documents.upsertElements(tx, boardId, writes, access.userId);
      await this.documents.rebuildFileReferences(tx, boardId);
      await tx.boardOperation.create({
        data: {
          boardId,
          seq,
          clientId: 'server',
          opId: `restore:${versionId}:${randomUUID()}`,
          userId: access.userId,
          type: 'RESTORE_VERSION',
          payload: { versionId, versionNumber: version.number, backupVersionId: backup } as Prisma.InputJsonValue,
          elementIds: writes.map((el) => el.id),
        },
      });
      await tx.board.update({
        where: { id: boardId },
        data: {
          seq,
          elementCount: target.size,
          appState: sanitizeAppState(snapshot.appState) as unknown as Prisma.InputJsonValue,
          opsSinceVersion: 0,
          lastVersionAt: new Date(),
        },
      });
      return backup;
    });
    await this.realtime.requestResync(boardId, 'version-restored');
    await this.realtime.emitEvent(boardId, { kind: 'version-restored', versionId });
    return toVersionDto(await this.prisma.boardVersion.findUniqueOrThrow({ where: { id: backupId }, select: summarySelect }));
  }
}
