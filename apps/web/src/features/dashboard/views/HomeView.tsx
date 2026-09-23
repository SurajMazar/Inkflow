import { Link } from 'react-router';
import { ArrowRight, LayoutDashboard, Plus } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@inkflow/ui';
import { useDocumentTitle } from '@/lib/use-document-title';
import { BoardCollection } from '../components/BoardCollection';
import { ImportBoardButton } from '../components/ImportBoardButton';
import { LazyTemplatePreview as TemplatePreview } from '../components/LazyTemplatePreview';
import { ViewContainer, ViewHeader } from '../components/ViewHeader';
import { useCreateFromTemplate } from '../components/useCreateFromTemplate';
import { useBoards, useTemplates } from '../hooks';
import { useDashboardUi } from '../ui-store';
import { useCurrentWorkspace } from '../WorkspaceContext';

/** Default dashboard view: quick start + every board in the workspace, most recent first. */
export function HomeView() {
  const { workspace } = useCurrentWorkspace();
  useDocumentTitle(workspace.name);
  const openNewBoard = useDashboardUi((s) => s.openNewBoard);
  const boards = useBoards({ workspaceId: workspace.id, filter: 'all' });
  const templates = useTemplates(workspace.id);
  const { createFromTemplate, pendingId } = useCreateFromTemplate(workspace.id);
  const suggestions = (templates.data ?? []).slice(0, 3);

  return (
    <ViewContainer>
      <ViewHeader
        title="Home"
        description={`Recent boards in ${workspace.name}`}
        actions={<ImportBoardButton workspaceId={workspace.id} />}
      />

      <section aria-labelledby="quick-start-heading" className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 id="quick-start-heading" className="text-sm font-medium text-muted-foreground">
            Start something new
          </h2>
          <Link
            to={`/w/${workspace.id}/templates`}
            className="inline-flex items-center gap-1 rounded-sm text-[13px] text-muted-foreground hover:text-foreground"
          >
            All templates <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => openNewBoard()}
            className="group flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-medium text-muted-foreground transition-colors outline-none hover:border-primary/50 hover:bg-brand-subtle/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
            data-testid="new-board-cta"
          >
            <span className="flex size-9 items-center justify-center rounded-lg border bg-background shadow-xs transition-colors group-hover:border-primary/40 group-hover:text-primary">
              <Plus className="size-4" aria-hidden />
            </span>
            Create board
          </button>
          {templates.isPending
            ? [0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[16/10] rounded-xl" />)
            : suggestions.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => createFromTemplate(template)}
                  disabled={pendingId === template.id}
                  className="group relative flex aspect-[16/10] flex-col overflow-hidden rounded-xl border text-left outline-none transition-colors hover:border-foreground/15 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60"
                  aria-label={`New board from template ${template.name}`}
                  data-testid="template-suggestion"
                >
                  <div className="min-h-0 flex-1">
                    <TemplatePreview templateId={template.id} />
                  </div>
                  <span className="truncate border-t bg-card px-3 py-2 text-[13px] font-medium">
                    {template.name}
                  </span>
                </button>
              ))}
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="grid gap-3">
        <h2 id="recent-heading" className="text-sm font-medium text-muted-foreground">
          Recent boards
        </h2>
        <BoardCollection
          label="Recent boards"
          boards={boards.data}
          isLoading={boards.isPending}
          isError={boards.isError}
          onRetry={() => void boards.refetch()}
          workspaceId={workspace.id}
          defaultSort="activity"
          emptyState={
            <EmptyState
              icon={<LayoutDashboard />}
              title="No boards yet"
              description="Create your first board, start from a template or import a file."
              action={
                <>
                  <Button size="sm" onClick={() => openNewBoard()}>
                    <Plus aria-hidden />
                    New board
                  </Button>
                  <ImportBoardButton workspaceId={workspace.id} label="Import file" />
                </>
              }
            />
          }
        />
      </section>
    </ViewContainer>
  );
}

export default HomeView;
