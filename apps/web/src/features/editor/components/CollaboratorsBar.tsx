import { initialsFor } from '@inkflow/shared';
import { Avatar, AvatarFallback, AvatarImage, Tooltip, TooltipContent, TooltipTrigger, cn } from '@inkflow/ui';
import { Eye } from 'lucide-react';
import { useEditor, useEditorState } from '../hooks/editor-context';

const MAX_VISIBLE = 4;

/** Avatars of everyone on the board; click one to follow their viewport. */
export function CollaboratorsBar() {
  const editor = useEditor();
  const collaborators = useEditorState((s) => s.collaborators);
  const following = useEditorState((s) => s.followingClientId);
  if (collaborators.length === 0) return null;
  // One avatar per user even when they have several tabs open.
  const byUser = new Map<string, (typeof collaborators)[number]>();
  for (const c of collaborators) if (!byUser.has(c.userId)) byUser.set(c.userId, c);
  const unique = [...byUser.values()];
  const visible = unique.slice(0, MAX_VISIBLE);
  const extra = unique.length - visible.length;
  return (
    <div className="flex items-center -space-x-1.5" role="list" aria-label="People on this board" data-testid="collaborators">
      {visible.map((c) => (
        <Tooltip key={c.clientId}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="listitem"
              aria-label={following === c.clientId ? `Stop following ${c.name}` : `Follow ${c.name}`}
              onClick={() => editor.followCollaborator(following === c.clientId ? null : c.clientId)}
              className={cn('rounded-full ring-2 ring-background transition hover:z-10 hover:scale-105', following === c.clientId && 'z-10')}
              style={{ boxShadow: `0 0 0 2px ${c.color}` }}
              data-testid="collaborator-avatar"
            >
              <Avatar className="size-7">
                {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                <AvatarFallback className="text-[10px] font-semibold text-white" style={{ background: c.color }}>
                  {initialsFor(c.name)}
                </AvatarFallback>
              </Avatar>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <span className="flex items-center gap-1">
              {following === c.clientId && <Eye className="size-3" />}
              {c.name}
              {c.anonymous ? ' (guest)' : ''} · {following === c.clientId ? 'following' : 'click to follow'}
            </span>
          </TooltipContent>
        </Tooltip>
      ))}
      {extra > 0 && (
        <span className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold ring-2 ring-background">+{extra}</span>
      )}
    </div>
  );
}
