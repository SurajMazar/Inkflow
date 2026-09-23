import { Injectable } from '@nestjs/common';
import { isUuid, type SearchResultDto } from '@inkflow/shared';
import { Errors } from '../common/errors';
import { escapeLike, iso } from '../common/mappers';
import { snippetAround } from '../documents/search-text';
import { PrismaService } from '../prisma/prisma.service';

const MATCHES_PER_BOARD = 5;

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Boards the user can open whose title matches (ILIKE) or whose element text/labels/frame names
   * match (`search_text`, trigram-indexed ILIKE), with snippets of the matching elements.
   */
  async search(userId: string, query: { q: string; workspaceId?: string; limit: number }): Promise<SearchResultDto[]> {
    if (query.workspaceId && !isUuid(query.workspaceId)) throw Errors.notFound('Workspace');
    const q = query.q.trim();
    const pattern = `%${escapeLike(q)}%`;
    const workspaceId = query.workspaceId ?? null;
    const boards = await this.prisma.$queryRaw<
      { id: string; title: string; workspace_id: string; updated_at: Date; title_match: boolean }[]
    >`
      WITH accessible AS (
        SELECT b.id, b.title, b.workspace_id, b.updated_at
        FROM boards b
        WHERE b.deleted_at IS NULL
          AND (${workspaceId}::uuid IS NULL OR b.workspace_id = ${workspaceId}::uuid)
          AND (
            b.owner_id = ${userId}::uuid
            OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = ${userId}::uuid)
            OR EXISTS (
              SELECT 1 FROM workspace_members wm
              WHERE wm.workspace_id = b.workspace_id AND wm.user_id = ${userId}::uuid
                AND (wm.role IN ('OWNER', 'ADMIN') OR b.workspace_access <> 'NONE')
            )
          )
      )
      SELECT a.id, a.title, a.workspace_id, a.updated_at, (a.title ILIKE ${pattern}) AS title_match
      FROM accessible a
      WHERE a.title ILIKE ${pattern}
         OR EXISTS (
           SELECT 1 FROM board_elements e
           WHERE e.board_id = a.id AND e.is_deleted = false AND e.search_text ILIKE ${pattern}
         )
      ORDER BY title_match DESC, a.updated_at DESC
      LIMIT ${query.limit}`;
    if (boards.length === 0) return [];

    const ids = boards.map((b) => b.id);
    const matches = await this.prisma.$queryRaw<{ board_id: string; element_id: string; type: string; search_text: string }[]>`
      SELECT board_id, element_id, type, search_text FROM (
        SELECT e.board_id, e.element_id, e.type, e.search_text,
               row_number() OVER (PARTITION BY e.board_id ORDER BY similarity(e.search_text, ${q}) DESC, e.element_id) AS rn
        FROM board_elements e
        WHERE e.board_id = ANY(${ids}::uuid[]) AND e.is_deleted = false AND e.search_text ILIKE ${pattern}
      ) ranked
      WHERE rn <= ${MATCHES_PER_BOARD}`;
    const byBoard = new Map<string, SearchResultDto['matches']>();
    for (const m of matches) {
      const list = byBoard.get(m.board_id) ?? [];
      list.push({ elementId: m.element_id, elementType: m.type, text: snippetAround(m.search_text, q) });
      byBoard.set(m.board_id, list);
    }
    return boards.map((b) => ({
      boardId: b.id,
      boardTitle: b.title,
      workspaceId: b.workspace_id,
      titleMatch: b.title_match,
      matches: byBoard.get(b.id) ?? [],
      updatedAt: iso(b.updated_at),
    }));
  }
}
