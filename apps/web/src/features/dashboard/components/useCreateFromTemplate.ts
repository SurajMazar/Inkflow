import * as React from 'react';
import { useNavigate } from 'react-router';
import type { TemplateSummaryDto } from '@inkflow/shared';
import { toastApiError } from '@/features/notifications/notify';
import { useBoardMutations } from '../hooks';

/** Creates a board from a template (`POST /boards { templateId }`) and opens it. */
export function useCreateFromTemplate(workspaceId: string, location: { projectId?: string | null; folderId?: string | null } = {}) {
  const { mutate } = useBoardMutations().create;
  const navigate = useNavigate();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const { projectId = null, folderId = null } = location;
  const createFromTemplate = React.useCallback(
    (template: TemplateSummaryDto) => {
      setPendingId(template.id);
      mutate(
        { workspaceId, templateId: template.id, title: template.name, projectId, folderId },
        {
          onSuccess: (board) => navigate(`/b/${board.id}`),
          onError: (error) => toastApiError(error, "Couldn't create a board from this template"),
          onSettled: () => setPendingId(null),
        },
      );
    },
    [mutate, workspaceId, projectId, folderId, navigate],
  );
  return { createFromTemplate, pendingId };
}
