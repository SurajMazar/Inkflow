import type { CommentDto } from '@inkflow/shared';
import { cn } from '@inkflow/ui';
import { MessageSquarePlus } from 'lucide-react';
import { useBoardSession, useEditorState } from '../hooks/editor-context';
import { useEditorUi } from '../hooks/ui-store';
import { anchorWorldPosition, revealComment, useBoardComments } from '../panels/comments/use-comments';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Screen-space markers for comment threads (and the pending draft), positioned with the viewport. */
export function CommentPins() {
  const { editor } = useBoardSession();
  const viewport = useEditorState((s) => s.viewport);
  useEditorState((s) => s.sceneVersion);
  const showResolved = useEditorUi((s) => s.showResolvedComments);
  const activeId = useEditorUi((s) => s.activeCommentId);
  const draft = useEditorUi((s) => s.commentDraft);
  const setPanel = useEditorUi((s) => s.setPanel);
  const setActive = useEditorUi((s) => s.setActiveComment);
  const { data } = useBoardComments();

  const toScreen = (p: { x: number; y: number }) => ({ x: (p.x - viewport.x) * viewport.zoom, y: (p.y - viewport.y) * viewport.zoom });
  const onScreen = (p: { x: number; y: number }) => p.x > -40 && p.y > -40 && p.x < viewport.width + 40 && p.y < viewport.height + 40;

  const pins: { comment: CommentDto; x: number; y: number }[] = [];
  for (const comment of data ?? []) {
    if (comment.resolvedAt && !showResolved && comment.id !== activeId) continue;
    const world = anchorWorldPosition(editor, comment.anchor);
    if (!world) continue;
    const s = toScreen(world);
    if (onScreen(s)) pins.push({ comment, ...s });
  }
  const draftScreen = draft ? toScreen(draft.world) : null;

  const open = (comment: CommentDto) => {
    setPanel('comments');
    setActive(comment.id);
    revealComment(editor, comment);
  };

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-inkflow-ui aria-label="Comments on canvas" role="group">
      {pins.map(({ comment, x, y }) => {
        const count = 1 + comment.replies.length;
        const name = comment.author.name || comment.author.email;
        const active = comment.id === activeId;
        return (
          <button
            key={comment.id}
            type="button"
            data-testid="comment-pin"
            data-comment-id={comment.id}
            aria-label={`Comment by ${name}${count > 1 ? `, ${count - 1} ${count === 2 ? 'reply' : 'replies'}` : ''}${comment.resolvedAt ? ' (resolved)' : ''}`}
            aria-pressed={active}
            onClick={() => open(comment)}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ transform: `translate(${Math.round(x)}px, ${Math.round(y) - 32}px)` }}
            className={cn(
              'pointer-events-auto absolute top-0 left-0 flex h-8 min-w-8 items-center gap-1 rounded-full rounded-bl-none border-2 bg-popover pr-1.5 pl-0.5 shadow-md outline-none transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'z-10 border-primary' : 'border-background hover:z-10',
              comment.resolvedAt && 'opacity-70',
            )}
          >
            {comment.author.avatarUrl ? (
              <img src={comment.author.avatarUrl} alt="" className="size-6 rounded-full object-cover" />
            ) : (
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {initials(name)}
              </span>
            )}
            {count > 1 && <span className="text-[11px] font-medium tabular-nums">{count}</span>}
          </button>
        );
      })}
      {draftScreen && onScreen(draftScreen) && (
        <div
          data-testid="comment-draft-pin"
          aria-hidden="true"
          style={{ transform: `translate(${Math.round(draftScreen.x)}px, ${Math.round(draftScreen.y) - 32}px)` }}
          className="absolute top-0 left-0 flex size-8 items-center justify-center rounded-full rounded-bl-none border-2 border-primary bg-primary text-primary-foreground shadow-md"
        >
          <MessageSquarePlus className="size-4" />
        </div>
      )}
    </div>
  );
}
