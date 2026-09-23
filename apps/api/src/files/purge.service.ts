import { Injectable, Logger } from '@nestjs/common';
import { RealtimeService } from '../collaboration/realtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/** Permanent deletion of boards/workspaces including their stored objects. */
@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Deletes boards (cascading to elements, versions, comments, files…) and orphaned objects. */
  async purgeBoards(boardIds: string[]): Promise<number> {
    const ids = [...new Set(boardIds)];
    if (ids.length === 0) return 0;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const [files, boards] = await Promise.all([
        this.prisma.file.findMany({ where: { boardId: { in: chunk } }, select: { storageKey: true }, distinct: ['storageKey'] }),
        this.prisma.board.findMany({ where: { id: { in: chunk } }, select: { id: true, thumbnailKey: true } }),
      ]);
      const res = await this.prisma.board.deleteMany({ where: { id: { in: chunk } } });
      deleted += res.count;
      await Promise.all(boards.map((b) => this.realtime.emitEvent(b.id, { kind: 'board-deleted' })));
      await this.deleteOrphanedObjects(files.map((f) => f.storageKey));
      const thumbnails = boards.map((b) => b.thumbnailKey).filter((k): k is string => !!k);
      if (thumbnails.length > 0) await this.storage.deleteMany(thumbnails);
    }
    return deleted;
  }

  /** Deletes objects whose key is no longer referenced by any file row. */
  async deleteOrphanedObjects(keys: string[]): Promise<void> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return;
    const stillUsed = await this.prisma.file.findMany({
      where: { storageKey: { in: unique } },
      select: { storageKey: true },
      distinct: ['storageKey'],
    });
    const used = new Set(stillUsed.map((f) => f.storageKey));
    const orphaned = unique.filter((k) => !used.has(k));
    if (orphaned.length > 0) {
      await this.storage.deleteMany(orphaned);
      this.logger.log(`Deleted ${orphaned.length} orphaned object(s)`);
    }
  }

  async purgeWorkspace(workspaceId: string): Promise<void> {
    const boards = await this.prisma.board.findMany({ where: { workspaceId }, select: { id: true } });
    await this.purgeBoards(boards.map((b) => b.id));
    await this.prisma.workspace.deleteMany({ where: { id: workspaceId } });
  }
}
