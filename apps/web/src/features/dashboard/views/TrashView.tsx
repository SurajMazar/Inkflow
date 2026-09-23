import * as React from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  EmptyState,
  Skeleton,
  Spinner,
} from '@inkflow/ui';
import { canManageBoard, type BoardSummaryDto } from '@inkflow/shared';
import { formatDateTime, formatRelativeTime, pluralize } from '@/lib/format';
import { useDocumentTitle } from '@/lib/use-document-title';
import { BoardThumbnail } from '../components/BoardThumbnail';
import { ViewContainer, ViewHeader } from '../components/ViewHeader';
import { useBoardMutations, useBoards } from '../hooks';
import { useCurrentWorkspace } from '../WorkspaceContext';

export function TrashView() {
  const { workspace } = useCurrentWorkspace();
  useDocumentTitle('Trash');
  const boards = useBoards({ workspaceId: workspace.id, filter: 'trash' });
  const { restore, deleteForever, emptyTrash } = useBoardMutations();
  const [confirmBoard, setConfirmBoard] = React.useState<BoardSummaryDto | null>(null);
  const [confirmEmpty, setConfirmEmpty] = React.useState(false);
  const items = React.useMemo(
    () =>
      [...(boards.data ?? [])].sort(
        (a, b) => Date.parse(b.deletedAt ?? b.updatedAt) - Date.parse(a.deletedAt ?? a.updatedAt),
      ),
    [boards.data],
  );

  return (
    <ViewContainer>
      <ViewHeader
        title="Trash"
        description="Restore boards or delete them permanently."
        actions={
          items.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmEmpty(true)}
              data-testid="trash-empty"
            >
              <Trash2 aria-hidden />
              Empty trash
            </Button>
          ) : null
        }
      />
      {boards.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : boards.isError ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm" role="alert">
          Couldn't load the trash.{' '}
          <button
            type="button"
            className="font-medium underline underline-offset-4"
            onClick={() => void boards.refetch()}
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Trash2 />}
          title="Trash is empty"
          description="Boards you delete stay here until you remove them permanently."
        />
      ) : (
        <ul
          className="divide-y overflow-hidden rounded-xl border"
          aria-label="Boards in the trash"
          data-testid="trash-list"
        >
          {items.map((board) => {
            const manageable = canManageBoard(board.role);
            return (
              <li
                key={board.id}
                className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap"
                data-testid="board-card"
                data-board-id={board.id}
              >
                <div className="aspect-[16/10] w-14 shrink-0 overflow-hidden rounded-md border">
                  <BoardThumbnail board={board} className="[&_svg]:p-1" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{board.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Deleted{' '}
                    <time
                      dateTime={board.deletedAt ?? undefined}
                      title={formatDateTime(board.deletedAt)}
                    >
                      {formatRelativeTime(board.deletedAt ?? board.updatedAt)}
                    </time>{' '}
                    · {board.owner.name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!manageable || restore.isPending}
                    onClick={() => restore.mutate(board)}
                    data-testid="trash-restore"
                  >
                    <RotateCcw aria-hidden />
                    Restore
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={!manageable}
                    onClick={() => setConfirmBoard(board)}
                    data-testid="trash-delete-forever"
                  >
                    Delete forever
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={!!confirmBoard} onOpenChange={(open) => !open && setConfirmBoard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirmBoard?.title}” forever?</AlertDialogTitle>
            <AlertDialogDescription>
              The board, its versions and comments will be permanently deleted. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmBoard) deleteForever.mutate(confirmBoard);
                setConfirmBoard(null);
              }}
              data-testid="trash-delete-confirm"
            >
              Delete forever
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty the trash?</AlertDialogTitle>
            <AlertDialogDescription>
              {pluralize(items.length, 'board')} will be permanently deleted. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={emptyTrash.isPending}
              onClick={() =>
                emptyTrash.mutate(workspace.id, { onSettled: () => setConfirmEmpty(false) })
              }
              data-testid="trash-empty-confirm"
            >
              {emptyTrash.isPending ? <Spinner className="text-current" label={null} /> : null}
              Empty trash
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ViewContainer>
  );
}

export default TrashView;
