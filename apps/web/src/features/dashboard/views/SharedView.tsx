import { Users } from 'lucide-react';
import { EmptyState } from '@inkflow/ui';
import { useDocumentTitle } from '@/lib/use-document-title';
import { BoardCollection } from '../components/BoardCollection';
import { ViewContainer, ViewHeader } from '../components/ViewHeader';
import { useBoards } from '../hooks';
import { useCurrentWorkspace } from '../WorkspaceContext';

export function SharedView() {
  const { workspace } = useCurrentWorkspace();
  useDocumentTitle('Shared with me');
  const boards = useBoards({ filter: 'shared' });
  return (
    <ViewContainer>
      <ViewHeader title="Shared with me" description="Boards other people invited you to." />
      <BoardCollection
        label="Boards shared with me"
        boards={boards.data}
        isLoading={boards.isPending}
        isError={boards.isError}
        onRetry={() => void boards.refetch()}
        workspaceId={workspace.id}
        defaultSort="activity"
        emptyState={
          <EmptyState
            icon={<Users />}
            title="Nothing shared with you yet"
            description="When someone shares a board with you, it will appear here."
          />
        }
      />
    </ViewContainer>
  );
}

export default SharedView;
