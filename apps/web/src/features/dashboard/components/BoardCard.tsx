import { Link } from 'react-router';
import { Badge, ContextMenu, ContextMenuTrigger, SimpleTooltip, UserAvatar, cn } from '@inkflow/ui';
import type { BoardSummaryDto } from '@inkflow/shared';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { BoardThumbnail } from './BoardThumbnail';
import { BoardContextMenuContent, BoardMenu } from './BoardMenu';
import { FavoriteButton } from './FavoriteButton';

export interface BoardItemProps {
  board: BoardSummaryDto;
  workspaceId: string;
}

export function roleLabel(role: BoardSummaryDto['role']): string {
  return role === 'OWNER' ? 'Owner' : role === 'EDITOR' ? 'Can edit' : 'Can view';
}

/** Grid card: thumbnail, title, last edit, owner, favorite star, role badge and actions menu. */
export function BoardCard({ board, workspaceId }: BoardItemProps) {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <article
          data-testid="board-card"
          data-board-id={board.id}
          className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow] hover:border-foreground/15 hover:shadow-xs focus-within:border-ring/60"
        >
          <Link
            to={`/b/${board.id}`}
            className="flex flex-1 flex-col rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <div className="aspect-[16/10] border-b">
              <BoardThumbnail board={board} />
            </div>
            <div className="flex min-w-0 flex-col gap-1 px-3 pt-2.5 pr-11 pb-3">
              <h3 className="truncate text-sm font-medium" title={board.title}>
                {board.title}
              </h3>
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <UserAvatar
                  name={board.owner.name}
                  src={board.owner.avatarUrl}
                  className="size-4 text-[8px]"
                />
                <span className="truncate">
                  <span className="sr-only">Owned by {board.owner.name}. </span>
                  Edited{' '}
                  <time dateTime={board.updatedAt} title={formatDateTime(board.updatedAt)}>
                    {formatRelativeTime(board.updatedAt)}
                  </time>
                </span>
              </p>
            </div>
          </Link>
          {board.role !== 'OWNER' ? (
            <Badge
              variant="secondary"
              className="pointer-events-none absolute top-2 left-2 bg-background/90 backdrop-blur"
              data-testid="board-role"
            >
              {roleLabel(board.role)}
            </Badge>
          ) : null}
          <SimpleTooltip content={board.isFavorite ? 'Unfavorite' : 'Favorite'}>
            <FavoriteButton
              board={board}
              className={cn(
                'absolute top-1.5 right-1.5 bg-background/80 backdrop-blur transition-opacity hover:bg-background',
                board.isFavorite
                  ? 'opacity-100'
                  : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100',
              )}
            />
          </SimpleTooltip>
          <BoardMenu
            board={board}
            workspaceId={workspaceId}
            className="absolute right-1.5 bottom-2"
          />
        </article>
      </ContextMenuTrigger>
      <BoardContextMenuContent board={board} workspaceId={workspaceId} />
    </ContextMenu>
  );
}

/** Compact list row with the same information and actions as `BoardCard`. */
export function BoardRow({ board, workspaceId }: BoardItemProps) {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <li
          data-testid="board-card"
          data-board-id={board.id}
          className="group relative grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/60 focus-within:bg-accent/60 sm:grid-cols-[56px_minmax(0,1fr)_160px_120px_auto]"
        >
          <div className="aspect-[16/10] w-14 overflow-hidden rounded-md border">
            <BoardThumbnail board={board} className="[&_svg]:p-1" />
          </div>
          <div className="min-w-0">
            <Link
              to={`/b/${board.id}`}
              className="block truncate rounded-sm text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:ring-[3px] focus-visible:ring-ring/40"
              title={board.title}
            >
              {board.title}
            </Link>
            <p className="truncate text-xs text-muted-foreground sm:hidden">
              {board.owner.name} · {formatRelativeTime(board.updatedAt)}
            </p>
          </div>
          <div className="hidden min-w-0 items-center gap-2 text-[13px] text-muted-foreground sm:flex">
            <UserAvatar
              name={board.owner.name}
              src={board.owner.avatarUrl}
              className="size-5 text-[9px]"
            />
            <span className="truncate">{board.owner.name}</span>
          </div>
          <time
            dateTime={board.updatedAt}
            title={formatDateTime(board.updatedAt)}
            className="hidden text-[13px] text-muted-foreground sm:block"
          >
            {formatRelativeTime(board.updatedAt)}
          </time>
          <div className="relative z-10 flex items-center gap-1">
            {board.role !== 'OWNER' ? (
              <Badge variant="outline" className="hidden md:inline-flex" data-testid="board-role">
                {roleLabel(board.role)}
              </Badge>
            ) : null}
            <FavoriteButton
              board={board}
              className={cn(
                !board.isFavorite &&
                  'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100',
              )}
            />
            <BoardMenu board={board} workspaceId={workspaceId} />
          </div>
        </li>
      </ContextMenuTrigger>
      <BoardContextMenuContent board={board} workspaceId={workspaceId} />
    </ContextMenu>
  );
}
