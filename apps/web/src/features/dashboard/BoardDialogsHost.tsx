import * as React from 'react';
import { ShareDialog } from '@/features/sharing/ShareDialog';
import { RenameDialog } from './components/RenameDialog';
import { MoveBoardDialog } from './components/MoveBoardDialog';
import { useBoardMutations } from './hooks';
import { useDashboardUi } from './ui-store';

/** Keeps the last non-null value so dialogs can animate out after their subject is cleared. */
function useLatest<T>(value: T | null): T | null {
  const [latest, setLatest] = React.useState(value);
  if (value !== null && value !== latest) setLatest(value);
  return value ?? latest;
}

/** Rename / move / share dialogs for boards, opened from cards, rows and menus. */
export function BoardDialogsHost() {
  const renameBoard = useDashboardUi((s) => s.renameBoard);
  const setRenameBoard = useDashboardUi((s) => s.setRenameBoard);
  const moveBoard = useDashboardUi((s) => s.moveBoard);
  const setMoveBoard = useDashboardUi((s) => s.setMoveBoard);
  const shareBoard = useDashboardUi((s) => s.shareBoard);
  const setShareBoard = useDashboardUi((s) => s.setShareBoard);
  const { rename } = useBoardMutations();
  const lastRename = useLatest(renameBoard);
  const lastShare = useLatest(shareBoard);

  return (
    <>
      <RenameDialog
        open={!!renameBoard}
        onOpenChange={(open) => !open && setRenameBoard(null)}
        title="Rename board"
        label="Board title"
        initialValue={lastRename?.title ?? ''}
        onSubmit={(title) => (lastRename ? rename.mutateAsync({ board: lastRename, title }) : Promise.resolve())}
      />
      <MoveBoardDialog board={moveBoard} onOpenChange={(open) => !open && setMoveBoard(null)} />
      {lastShare ? (
        <ShareDialog
          boardId={lastShare.id}
          open={!!shareBoard}
          onOpenChange={(open) => !open && setShareBoard(null)}
          role={lastShare.role}
          boardTitle={lastShare.title}
        />
      ) : null}
    </>
  );
}
