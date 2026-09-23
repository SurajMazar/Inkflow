import { ApiError } from '@inkflow/shared';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Spinner, Switch, cn } from '@inkflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/features/auth';
import { readBoardFile } from '@/features/dashboard/import-board';
import { notify, toastApiError } from '@/features/notifications/notify';
import { useBoardSession } from '../hooks/editor-context';
import { importFilesIntoEditor } from './import-files';

const ACCEPT = '.inkflow,.json,.excalidraw,.svg,.png,.jpg,.jpeg,.webp,.gif,.mmd,.mermaid,.txt,application/json,image/*';

function isBoardFile(file: File): boolean {
  return /\.(inkflow|excalidraw|json)$/i.test(file.name) || file.type === 'application/json' || file.type === 'application/vnd.inkflow+json';
}

/** Imports files into the board, or native/Excalidraw files as a new board. */
export function ImportDialog({ onClose }: { onClose(): void }) {
  const { editor, board, canEdit } = useBoardSession();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [files, setFiles] = React.useState<File[]>([]);
  const [asNewBoard, setAsNewBoard] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const allBoardFiles = files.length > 0 && files.every(isBoardFile);
  const canCreateBoard = !!user && !!board.workspaceId && allBoardFiles;
  const newBoard = asNewBoard && canCreateBoard;
  const disabled = files.length === 0 || busy || (!newBoard && !canEdit);

  const run = async () => {
    setBusy(true);
    try {
      if (newBoard) {
        let firstId: string | null = null;
        for (const file of files) {
          try {
            const parsed = await readBoardFile(file);
            const created = await api.boards.create({ workspaceId: board.workspaceId, title: parsed.title, document: parsed.document });
            firstId ??= created.id;
            notify.success(`Created “${created.title}”`, {
              description: parsed.skipped ? `${parsed.skipped} item${parsed.skipped === 1 ? ' was' : 's were'} skipped.` : undefined,
            });
          } catch (error) {
            if (error instanceof ApiError) toastApiError(error, `Couldn't import ${file.name}`);
            else notify.error(`Couldn't import ${file.name}`, { description: error instanceof Error ? error.message : undefined });
          }
        }
        void qc.invalidateQueries({ queryKey: queryKeys.boards.lists });
        if (firstId) {
          onClose();
          navigate(`/b/${firstId}`);
        }
        return;
      }
      onClose();
      await importFilesIntoEditor(editor, files);
    } finally {
      setBusy(false);
    }
  };

  const pick = (list: FileList | null) => {
    const next = [...(list ?? [])];
    if (next.length) setFiles(next);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" data-inkflow-ui data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>Inkflow and Excalidraw files, SVG, PNG (with embedded scenes), JPEG, WebP, GIF and Mermaid text.</DialogDescription>
        </DialogHeader>
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose files to import, or drop them here"
          data-testid="import-dropzone"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pick(e.dataTransfer.files);
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/40',
          )}
        >
          <FileUp className="size-6 text-muted-foreground" aria-hidden />
          {files.length ? (
            <div className="text-sm">
              <div className="font-medium">{files.length === 1 ? files[0]!.name : `${files.length} files`}</div>
              <div className="text-xs text-muted-foreground">Click to choose different files</div>
            </div>
          ) : (
            <div className="text-sm">
              <span className="font-medium text-primary">Choose files</span> or drop them here
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            data-testid="import-file-input"
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {canCreateBoard && (
          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
            <span>
              Import as a new board
              <span className="block text-xs text-muted-foreground">Creates a separate board in this workspace instead of adding to this one.</span>
            </span>
            <Switch checked={asNewBoard} onCheckedChange={setAsNewBoard} aria-label="Import as a new board" data-testid="import-as-new-board" />
          </label>
        )}
        {!canEdit && !newBoard && (
          <p className="text-xs text-muted-foreground" role="note">
            You can only view this board. {canCreateBoard ? 'Import the file as a new board instead.' : 'Ask an owner for edit access to import.'}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={disabled} data-testid="import-submit">
            {busy && <Spinner className="size-4" />}
            {newBoard ? 'Create board' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
