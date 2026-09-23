import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { PurgeService } from '../files/purge.service';
import { PrismaService } from '../prisma/prisma.service';

/** Advisory lock keys (pg_try_advisory_xact_lock) so only one instance runs each job. */
export const JOB_LOCKS = {
  trashPurge: 7_310_001,
  opCompaction: 7_310_002,
  tokenCleanup: 7_310_003,
} as const;

export const JOB_INTERVAL_MS = 3_600_000;
const FIRST_RUN_DELAY_MS = 60_000;
/** Operations older than this may be compacted… */
export const OP_RETENTION_DAYS = 30;
/** …but the latest N of every board are always kept (reconnect replay / idempotency). */
export const OPS_KEPT_PER_BOARD = 1_000;
const DELETE_BATCH = 10_000;

@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private timers: NodeJS.Timeout[] = [];
  private running: Promise<unknown> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly purge: PurgeService,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.isTest) return; // tests invoke the jobs explicitly
    const first = setTimeout(() => this.runAll(), FIRST_RUN_DELAY_MS);
    const every = setInterval(() => this.runAll(), JOB_INTERVAL_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    await this.running?.catch(() => undefined);
  }

  private runAll(): void {
    if (this.stopped || this.running) return;
    this.running = (async () => {
      await this.purgeTrash().catch((err: Error) =>
        this.logger.error(`Trash purge failed: ${err.message}`),
      );
      await this.compactOperations().catch((err: Error) =>
        this.logger.error(`Op-log compaction failed: ${err.message}`),
      );
      await this.cleanupTokens().catch((err: Error) =>
        this.logger.error(`Token cleanup failed: ${err.message}`),
      );
    })().finally(() => {
      this.running = null;
    });
  }

  /**
   * Runs `work` while holding a transaction-scoped advisory lock on a dedicated connection. Returns
   * null when another instance holds the lock.
   */
  async withLock<T>(key: number, work: () => Promise<T>): Promise<T | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${key}::bigint) AS locked`;
        if (!rows[0]?.locked) return null;
        return work();
      },
      { timeout: 30 * 60_000, maxWait: 10_000 },
    );
  }

  /** Permanently deletes boards that have been in the trash longer than TRASH_RETENTION_DAYS. */
  async purgeTrash(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.env.TRASH_RETENTION_DAYS * 86_400_000);
    const result = await this.withLock(JOB_LOCKS.trashPurge, async () => {
      let total = 0;
      for (;;) {
        const boards = await this.prisma.board.findMany({
          where: { deletedAt: { not: null, lt: cutoff } },
          select: { id: true },
          take: 200,
        });
        if (boards.length === 0) break;
        total += await this.purge.purgeBoards(boards.map((b) => b.id));
        if (this.stopped) break;
      }
      return total;
    });
    if (result) this.logger.log(`Purged ${result} board(s) from the trash`);
    return result ?? 0;
  }

  /** Deletes operations older than OP_RETENTION_DAYS except the latest OPS_KEPT_PER_BOARD per board. */
  async compactOperations(now = new Date(), keepPerBoard = OPS_KEPT_PER_BOARD): Promise<number> {
    const cutoff = new Date(now.getTime() - OP_RETENTION_DAYS * 86_400_000);
    const result = await this.withLock(JOB_LOCKS.opCompaction, async () => {
      let total = 0;
      for (;;) {
        const deleted = await this.prisma.$executeRaw`
          DELETE FROM board_operations
          WHERE id IN (
            SELECT o.id FROM board_operations o
            JOIN boards b ON b.id = o.board_id
            WHERE o.created_at < ${cutoff} AND o.seq <= b.seq - ${BigInt(keepPerBoard)}
            LIMIT ${DELETE_BATCH}
          )`;
        total += deleted;
        if (deleted < DELETE_BATCH || this.stopped) break;
      }
      return total;
    });
    if (result) this.logger.log(`Compacted ${result} operation(s)`);
    return result ?? 0;
  }

  /** Removes expired sessions, verification/reset tokens and invitations. */
  async cleanupTokens(now = new Date()): Promise<void> {
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    await this.withLock(JOB_LOCKS.tokenCleanup, async () => {
      await this.prisma.session.deleteMany({
        where: { OR: [{ expiresAt: { lt: weekAgo } }, { revokedAt: { lt: weekAgo } }] },
      });
      await this.prisma.emailVerification.deleteMany({ where: { expiresAt: { lt: weekAgo } } });
      await this.prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: weekAgo } } });
      await this.prisma.workspaceInvitation.deleteMany({ where: { expiresAt: { lt: weekAgo } } });
    });
  }
}
