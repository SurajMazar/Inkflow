import * as React from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@inkflow/ui';
import type { BoardSummaryDto } from '@inkflow/shared';
import { toastApiError } from '@/features/notifications/notify';
import { useBoardMutations } from '../hooks';
import { LocationFields, type BoardLocation } from './LocationFields';

export function MoveBoardDialog({
  board,
  onOpenChange,
}: {
  board: BoardSummaryDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!board} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {board ? <MoveForm board={board} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({ board, onDone }: { board: BoardSummaryDto; onDone: () => void }) {
  const [location, setLocation] = React.useState<BoardLocation>({ projectId: board.projectId, folderId: board.folderId });
  const { move } = useBoardMutations();
  const unchanged = location.projectId === board.projectId && location.folderId === board.folderId;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    move.mutate(
      { board, ...location },
      { onSuccess: onDone, onError: (error) => toastApiError(error, "Couldn't move the board") },
    );
  };
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Move “{board.title}”</DialogTitle>
        <DialogDescription>Choose a project and folder in this workspace.</DialogDescription>
      </DialogHeader>
      <LocationFields workspaceId={board.workspaceId} value={location} onChange={setLocation} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={unchanged || move.isPending} data-testid="move-submit">
          {move.isPending ? <Spinner className="text-current" label={null} /> : null}
          Move
        </Button>
      </div>
    </form>
  );
}
