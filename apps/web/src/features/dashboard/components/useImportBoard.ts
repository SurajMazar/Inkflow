import * as React from 'react';
import { useNavigate } from 'react-router';
import { describeApiError, notify } from '@/features/notifications/notify';
import { useBoardMutations } from '../hooks';
import { readBoardFile } from '../import-board';

/** Imports a board file into a workspace location and opens it. */
export function useImportBoard(
  workspaceId: string,
  location: { projectId?: string | null; folderId?: string | null } = {},
) {
  const { mutateAsync: createBoard } = useBoardMutations().create;
  const navigate = useNavigate();
  const [importing, setImporting] = React.useState(false);
  const { projectId = null, folderId = null } = location;

  const importFile = React.useCallback(
    async (file: File) => {
      setImporting(true);
      const toastId = notify.message(`Importing ${file.name}…`);
      try {
        const imported = await readBoardFile(file);
        const board = await createBoard({
          workspaceId,
          projectId,
          folderId,
          title: imported.title,
          document: imported.document,
        });
        notify.dismiss(toastId);
        notify.success(`Imported “${board.title}”`, {
          description:
            imported.skipped > 0
              ? `${imported.skipped} item${imported.skipped === 1 ? '' : 's'} couldn't be imported.`
              : undefined,
        });
        navigate(`/b/${board.id}`);
      } catch (error) {
        notify.dismiss(toastId);
        if (error instanceof Error && !('code' in error)) {
          notify.error("Couldn't import the file", { description: error.message });
        } else {
          const { title, description } = describeApiError(error, "Couldn't import the file");
          notify.error(title, { description });
        }
      } finally {
        setImporting(false);
      }
    },
    [createBoard, workspaceId, projectId, folderId, navigate],
  );

  return { importFile, importing };
}
