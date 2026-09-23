import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@inkflow/database';
import { MAX_REPLAY_ELEMENTS, type OpResult, type ServerChange } from '@inkflow/collaboration';
import type { SceneElement } from '@inkflow/elements';
import { OPERATION_TYPES, type OperationType } from '@inkflow/scene';
import { RealtimeService } from '../collaboration/realtime.service';
import { Errors } from '../common/errors';
import { BoardDocumentService } from '../documents/board-document.service';
import { PrismaService } from '../prisma/prisma.service';
import { VersionsService } from '../versions/versions.service';
import { batchTargets, candidateFileIds, parseOps, planBatch, toServerChanges } from './batch';

export interface BatchResult {
  results: OpResult[];
  changes: ServerChange[];
  seq: number;
}

export interface Actor {
  userId: string | null;
}

/** Retries for serialization failures / deadlocks (should be rare: the board row is locked first). */
const MAX_TX_ATTEMPTS = 3;

function isRetryable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError)
    return err.code === 'P2034' || err.code === 'P2002';
  const message = (err as Error | undefined)?.message ?? '';
  return /deadlock detected|could not serialize/i.test(message);
}

/** Maps logged types (including server-side ones such as `RESTORE_VERSION`) to protocol types. */
export function toOperationType(type: string): OperationType {
  return (OPERATION_TYPES as readonly string[]).includes(type)
    ? (type as OperationType)
    : 'UPDATE_ELEMENT';
}

/** Persistent operation pipeline: validation, idempotency, ordering, persistence and fan-out. */
@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: BoardDocumentService,
    private readonly realtime: RealtimeService,
    private readonly versions: VersionsService,
  ) {}

  /**
   * Applies a batch in one transaction: dedupe on (client_id, op_id), lock the board, apply each
   * operation with per-property LWW merge, persist element states + the op log with consecutive
   * sequence numbers, then publish the committed changes to every instance.
   */
  async applyBatch(
    boardId: string,
    actor: Actor,
    clientId: string,
    rawOps: unknown[],
  ): Promise<BatchResult> {
    const parsed = parseOps(rawOps, clientId);
    const valid = parsed.flatMap((p) => (p.op ? [p.op] : []));
    let attempt = 0;
    for (;;) {
      try {
        const outcome = await this.prisma.$transaction(
          async (tx) => {
            const boards = await tx.$queryRaw<
              { seq: bigint; element_count: number; deleted_at: Date | null }[]
            >`
              SELECT seq, element_count, deleted_at FROM boards WHERE id = ${boardId}::uuid FOR UPDATE`;
            const board = boards[0];
            if (!board || board.deleted_at) throw Errors.notFound('Board');

            const opIds = [...new Set(valid.map((op) => op.opId))];
            const dupRows = opIds.length
              ? await tx.$queryRaw<{ op_id: string; seq: bigint }[]>`
                  SELECT op_id, seq FROM board_operations
                  WHERE board_id = ${boardId}::uuid AND client_id = ${clientId} AND op_id = ANY(${opIds}::text[])`
              : [];
            const duplicates = new Map(dupRows.map((r) => [r.op_id, Number(r.seq)]));

            const targets = batchTargets(valid.filter((op) => !duplicates.has(op.opId)));
            const rows = targets.length
              ? await tx.$queryRaw<{ element_id: string; data: SceneElement }[]>`
                  SELECT element_id, data FROM board_elements
                  WHERE board_id = ${boardId}::uuid AND element_id = ANY(${targets}::text[])
                  FOR UPDATE`
              : [];
            const current = new Map(rows.map((r) => [r.element_id, r.data]));

            const fileIds = candidateFileIds(valid);
            const fileRows = fileIds.length
              ? await tx.file.findMany({
                  where: { id: { in: fileIds } },
                  select: { id: true, boardId: true },
                })
              : [];
            const fileOwners = new Map(fileRows.map((f) => [f.id, f.boardId]));

            const plan = planBatch({
              boardId,
              startSeq: Number(board.seq),
              liveCount: board.element_count,
              current,
              ops: parsed,
              duplicates,
              files: { boardOf: (id) => fileOwners.get(id) ?? null },
              now: Date.now(),
            });

            if (plan.applied.length > 0) {
              const finals = [...plan.finalStates.values()];
              await this.documents.upsertElements(tx, boardId, finals, actor.userId);
              await this.documents.syncFileReferences(tx, boardId, finals);
              await tx.boardOperation.createMany({
                data: plan.applied.map(({ op, seq, elements }) => ({
                  boardId,
                  seq: BigInt(seq),
                  clientId,
                  opId: op.opId,
                  userId: actor.userId,
                  type: op.type,
                  payload: op as unknown as Prisma.InputJsonValue,
                  elementIds: elements.map((el) => el.id),
                })),
              });
              await tx.$executeRaw`
                UPDATE boards SET
                  seq = ${BigInt(plan.lastSeq)},
                  element_count = GREATEST(0, element_count + ${plan.liveDelta}),
                  ops_since_version = ops_since_version + ${plan.applied.length},
                  updated_at = now()
                WHERE id = ${boardId}::uuid`;
            }
            return { plan, seq: plan.lastSeq };
          },
          { timeout: 30_000, maxWait: 10_000 },
        );
        const changes = toServerChanges(outcome.plan.applied, clientId, actor.userId);
        if (changes.length > 0) {
          await this.realtime.publishMessage(boardId, { t: 'changes', changes });
          this.versions.scheduleAutoVersion(boardId);
        }
        return { results: outcome.plan.results, changes, seq: outcome.seq };
      } catch (err) {
        attempt++;
        if (attempt < MAX_TX_ATTEMPTS && isRetryable(err)) {
          this.logger.warn(`Retrying batch for board ${boardId} after ${(err as Error).message}`);
          continue;
        }
        throw err;
      }
    }
  }

  /** Current sequence number of a board. */
  async currentSeq(boardId: string): Promise<number> {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: { seq: true },
    });
    return board ? Number(board.seq) : 0;
  }

  /**
   * Current states of elements changed after `sinceSeq`, grouped by the operation that last touched
   * them. Null when the gap cannot be replayed (op log compacted, or more than
   * `MAX_REPLAY_ELEMENTS` elements) and the client must reload the document.
   */
  async changesSince(
    boardId: string,
    sinceSeq: number,
  ): Promise<{ seq: number; changes: ServerChange[] | null }> {
    const seq = await this.currentSeq(boardId);
    if (sinceSeq >= seq) return { seq, changes: [] };
    const oldest = await this.prisma.$queryRaw<{ min: bigint | null }[]>`
      SELECT min(seq) AS min FROM board_operations WHERE board_id = ${boardId}::uuid`;
    const min =
      oldest[0]?.min === null || oldest[0]?.min === undefined ? null : Number(oldest[0].min);
    if (min === null || min > sinceSeq + 1) return { seq, changes: null };

    const touched = await this.prisma.$queryRaw<
      {
        element_id: string;
        seq: bigint;
        op_id: string;
        client_id: string;
        user_id: string | null;
        type: string;
      }[]
    >`
      SELECT DISTINCT ON (t.element_id) t.element_id, o.seq, o.op_id, o.client_id, o.user_id, o.type
      FROM board_operations o, unnest(o.element_ids) AS t(element_id)
      WHERE o.board_id = ${boardId}::uuid AND o.seq > ${BigInt(sinceSeq)} AND o.seq <= ${BigInt(seq)}
      ORDER BY t.element_id, o.seq DESC
      LIMIT ${MAX_REPLAY_ELEMENTS + 1}`;
    if (touched.length > MAX_REPLAY_ELEMENTS) return { seq, changes: null };
    if (touched.length === 0) return { seq, changes: [] };

    const ids = touched.map((t) => t.element_id);
    const rows = await this.prisma.$queryRaw<{ element_id: string; data: SceneElement }[]>`
      SELECT element_id, data FROM board_elements WHERE board_id = ${boardId}::uuid AND element_id = ANY(${ids}::text[])`;
    const states = new Map(rows.map((r) => [r.element_id, r.data]));
    const groups = new Map<number, ServerChange>();
    for (const t of touched) {
      const el = states.get(t.element_id);
      if (!el) continue;
      const s = Number(t.seq);
      let change = groups.get(s);
      if (!change) {
        change = {
          seq: s,
          opId: t.op_id,
          clientId: t.client_id,
          userId: t.user_id,
          type: toOperationType(t.type),
          elements: [],
        };
        groups.set(s, change);
      }
      change.elements.push(el);
    }
    return { seq, changes: [...groups.values()].sort((a, b) => a.seq - b.seq) };
  }
}
