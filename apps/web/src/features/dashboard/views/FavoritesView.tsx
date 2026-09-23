import { Star } from 'lucide-react';
import { EmptyState } from '@inkflow/ui';
import { useDocumentTitle } from '@/lib/use-document-title';
import { BoardCollection } from '../components/BoardCollection';
import { ViewContainer, ViewHeader } from '../components/ViewHeader';
import { useBoards } from '../hooks';
import { useCurrentWorkspace } from '../WorkspaceContext';

export function FavoritesView() {
  const { workspace } = useCurrentWorkspace();
  useDocumentTitle('Favorites');
  const boards = useBoards({ workspaceId: workspace.id, filter: 'favorites' });
  return (
    <ViewContainer>
      <ViewHeader title="Favorites" description="Boards you starred for quick access." />
      <BoardCollection
        label="Favorite boards"
        boards={boards.data}
        isLoading={boards.isPending}
        isError={boards.isError}
        onRetry={() => void boards.refetch()}
        workspaceId={workspace.id}
        defaultSort="title"
        emptyState={
          <EmptyState
            icon={<Star />}
            title="No favorites yet"
            description="Star a board from its card or menu and it will show up here."
          />
        }
      />
    </ViewContainer>
  );
}

export default FavoritesView;
