import type { Editor } from '@inkflow/canvas-engine';
import type { Point } from '@inkflow/geometry';
import type { CommentAnchor, CommentDto } from '@inkflow/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useBoardSession } from '../../hooks/editor-context';
import type { CommentDraft } from '../../hooks/ui-store';

/**
 * Every comment thread of the board (open and resolved). The panel and the canvas pins share
 * this query and filter client-side.
 */
export function useBoardComments() {
  const { boardId, shareToken } = useBoardSession();
  return useQuery({
    queryKey: queryKeys.boards.comments(boardId),
    queryFn: ({ signal }): Promise<CommentDto[]> =>
      api.comments.list(boardId, { includeResolved: true }, { shareToken, signal }),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

/** World position of a comment anchor, or null when its element no longer exists. */
export function anchorWorldPosition(editor: Editor, anchor: CommentAnchor): Point | null {
  if (anchor.type === 'point') return { x: anchor.x, y: anchor.y };
  const el = editor.getElement(anchor.elementId);
  if (!el) return null;
  return { x: el.x + anchor.x, y: el.y + anchor.y };
}

/** API anchor for a new comment draft (element anchors are relative to the element's top-left). */
export function anchorFromDraft(editor: Editor, draft: CommentDraft): CommentAnchor {
  const el = draft.elementId ? editor.getElement(draft.elementId) : undefined;
  if (!el) return { type: 'point', x: draft.world.x, y: draft.world.y };
  return {
    type: el.type === 'frame' ? 'frame' : 'element',
    elementId: el.id,
    x: draft.world.x - el.x,
    y: draft.world.y - el.y,
  };
}

/** Pans to a comment's anchor and selects the anchored element (if any). */
export function revealComment(editor: Editor, comment: CommentDto): void {
  const pos = anchorWorldPosition(editor, comment.anchor);
  if (comment.anchor.type !== 'point' && editor.getElement(comment.anchor.elementId)) {
    editor.select([comment.anchor.elementId], { expandGroups: false });
  }
  if (pos) editor.scrollToPoint(pos);
}
