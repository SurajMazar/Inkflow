import * as React from 'react';
import { useNavigate } from 'react-router';
import {
  Copy,
  ExternalLink,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Share2,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import {
  Button,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@inkflow/ui';
import { canEditBoard, canManageBoard, type BoardSummaryDto } from '@inkflow/shared';
import { useBoardMutations } from '../hooks';
import { useDashboardUi } from '../ui-store';

interface MenuItemProps {
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive';
  children?: React.ReactNode;
  'data-testid'?: string;
}

interface MenuKit {
  Item: React.ComponentType<MenuItemProps>;
  Separator: React.ComponentType;
  testIdPrefix: string;
}

export interface BoardMenuOptions {
  /** Workspace currently shown; "Move" is only offered for boards in it. */
  workspaceId: string;
}

function BoardMenuItems({ board, kit, workspaceId }: { board: BoardSummaryDto; kit: MenuKit } & BoardMenuOptions) {
  const navigate = useNavigate();
  const { toggleFavorite, duplicate, trash } = useBoardMutations();
  const { setRenameBoard, setMoveBoard, setShareBoard } = useDashboardUi();
  const { Item, Separator, testIdPrefix: p } = kit;
  const editable = canEditBoard(board.role);
  return (
    <>
      <Item onSelect={() => navigate(`/b/${board.id}`)} data-testid={`${p}-open`}>
        <ExternalLink aria-hidden />
        Open
      </Item>
      <Item onSelect={() => setShareBoard(board)} disabled={!editable} data-testid={`${p}-share`}>
        <Share2 aria-hidden />
        Share…
      </Item>
      <Separator />
      <Item onSelect={() => setRenameBoard(board)} disabled={!editable} data-testid={`${p}-rename`}>
        <Pencil aria-hidden />
        Rename…
      </Item>
      <Item onSelect={() => toggleFavorite.mutate(board)} data-testid={`${p}-favorite`}>
        {board.isFavorite ? <StarOff aria-hidden /> : <Star aria-hidden />}
        {board.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      </Item>
      {board.workspaceId === workspaceId ? (
        <Item onSelect={() => setMoveBoard(board)} disabled={!editable} data-testid={`${p}-move`}>
          <FolderInput aria-hidden />
          Move to…
        </Item>
      ) : null}
      <Item onSelect={() => duplicate.mutate(board)} data-testid={`${p}-duplicate`}>
        <Copy aria-hidden />
        Duplicate
      </Item>
      <Separator />
      <Item
        variant="destructive"
        onSelect={() => trash.mutate(board)}
        disabled={!canManageBoard(board.role)}
        data-testid={`${p}-delete`}
      >
        <Trash2 aria-hidden />
        Move to trash
      </Item>
    </>
  );
}

/** "⋯" dropdown for a board card/row. */
export function BoardMenu({
  board,
  workspaceId,
  className,
}: { board: BoardSummaryDto; className?: string } & BoardMenuOptions) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground', className)}
          aria-label={`Actions for ${board.title}`}
          data-testid="board-card-menu"
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <BoardMenuItems
          board={board}
          workspaceId={workspaceId}
          kit={{ Item: DropdownMenuItem, Separator: DropdownMenuSeparator, testIdPrefix: 'board-menu' }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Right-click menu content with the same actions (wrap the card in `<ContextMenu>`). */
export function BoardContextMenuContent({ board, workspaceId }: { board: BoardSummaryDto } & BoardMenuOptions) {
  return (
    <ContextMenuContent className="w-52">
      <BoardMenuItems
        board={board}
        workspaceId={workspaceId}
        kit={{ Item: ContextMenuItem, Separator: ContextMenuSeparator, testIdPrefix: 'board-context' }}
      />
    </ContextMenuContent>
  );
}
