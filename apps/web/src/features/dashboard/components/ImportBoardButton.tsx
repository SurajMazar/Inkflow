import * as React from 'react';
import { Upload } from 'lucide-react';
import { Button, Spinner, type ButtonProps } from '@inkflow/ui';
import { IMPORT_ACCEPT } from '../import-board';
import { useImportBoard } from './useImportBoard';

/** Button + hidden file input that imports `.inkflow` / `.json` / `.excalidraw` files. */
export function ImportBoardButton({
  workspaceId,
  projectId = null,
  folderId = null,
  label = 'Import',
  ...buttonProps
}: {
  workspaceId: string;
  projectId?: string | null;
  folderId?: string | null;
  label?: string;
} & Omit<ButtonProps, 'onClick'>) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { importFile, importing } = useImportBoard(workspaceId, { projectId, folderId });
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={importing}
        onClick={() => inputRef.current?.click()}
        data-testid="import-board"
        {...buttonProps}
      >
        {importing ? <Spinner label={null} /> : <Upload aria-hidden />}
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="import-board-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importFile(file);
        }}
      />
    </>
  );
}
