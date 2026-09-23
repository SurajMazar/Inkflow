import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ChevronRight,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
} from '@inkflow/ui';
import type { FolderDto } from '@inkflow/shared';
import { useDocumentTitle } from '@/lib/use-document-title';
import { FullPageMessage } from '@/components/FullPageState';
import { BoardCollection } from '../components/BoardCollection';
import { ImportBoardButton } from '../components/ImportBoardButton';
import { RenameDialog } from '../components/RenameDialog';
import { ViewContainer, ViewHeader } from '../components/ViewHeader';
import {
  useBoards,
  useFolderMutations,
  useFolders,
  useProjectMutations,
  useProjects,
} from '../hooks';
import { useDashboardUi } from '../ui-store';
import { useCurrentWorkspace } from '../WorkspaceContext';

type FolderDialog =
  | { kind: 'create' }
  | { kind: 'rename'; folder: FolderDto }
  | { kind: 'delete'; folder: FolderDto }
  | { kind: 'rename-project' }
  | { kind: 'delete-project' }
  | null;

export function ProjectView() {
  const { workspace } = useCurrentWorkspace();
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const folderId = params.get('folder');
  const projects = useProjects(workspace.id);
  const folders = useFolders(workspace.id);
  const project = projects.data?.find((p) => p.id === projectId);
  useDocumentTitle(project?.name ?? 'Project');
  const openNewBoard = useDashboardUi((s) => s.openNewBoard);
  const folderMutations = useFolderMutations(workspace.id);
  const projectMutations = useProjectMutations(workspace.id);
  const [dialog, setDialog] = React.useState<FolderDialog>(null);

  const projectFolders = React.useMemo(
    () => (folders.data ?? []).filter((f) => f.projectId === projectId),
    [folders.data, projectId],
  );
  const currentFolder = folderId ? projectFolders.find((f) => f.id === folderId) : undefined;
  const effectiveFolderId = currentFolder?.id ?? null;
  const childFolders = React.useMemo(
    () =>
      projectFolders
        .filter((f) =>
          effectiveFolderId
            ? f.parentId === effectiveFolderId
            : !f.parentId || !projectFolders.some((p) => p.id === f.parentId),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projectFolders, effectiveFolderId],
  );
  const trail = React.useMemo(() => {
    const out: FolderDto[] = [];
    const seen = new Set<string>();
    let cursor = currentFolder;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      out.unshift(cursor);
      cursor = cursor.parentId ? projectFolders.find((f) => f.id === cursor!.parentId) : undefined;
    }
    return out;
  }, [currentFolder, projectFolders]);

  const boards = useBoards(
    {
      workspaceId: workspace.id,
      projectId,
      ...(effectiveFolderId ? { folderId: effectiveFolderId } : {}),
    },
    { enabled: !!project },
  );
  const boardsHere = React.useMemo(
    () => boards.data?.filter((b) => (b.folderId ?? null) === effectiveFolderId),
    [boards.data, effectiveFolderId],
  );

  const openFolder = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('folder', id);
    else next.delete('folder');
    setParams(next);
  };

  if (projects.isSuccess && !project) {
    return (
      <FullPageMessage
        title="Project not found"
        description="It may have been deleted."
        actions={
          <Button asChild variant="outline">
            <Link to={`/w/${workspace.id}`}>Back to home</Link>
          </Button>
        }
      />
    );
  }

  const breadcrumbs = project ? (
    <nav aria-label="Breadcrumb" className="mb-1">
      <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
        <li>
          <button
            type="button"
            className="rounded-sm hover:text-foreground"
            onClick={() => openFolder(null)}
          >
            {project.name}
          </button>
        </li>
        {trail.map((folder, index) => (
          <li key={folder.id} className="flex items-center gap-1">
            <ChevronRight className="size-3.5" aria-hidden />
            {index === trail.length - 1 ? (
              <span aria-current="page">{folder.name}</span>
            ) : (
              <button
                type="button"
                className="rounded-sm hover:text-foreground"
                onClick={() => openFolder(folder.id)}
              >
                {folder.name}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  ) : null;

  return (
    <ViewContainer>
      <ViewHeader
        breadcrumbs={trail.length > 0 ? breadcrumbs : undefined}
        title={project ? (currentFolder?.name ?? project.name) : <Skeleton className="h-7 w-48" />}
        description={!currentFolder ? project?.description || undefined : undefined}
        actions={
          project ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialog({ kind: 'create' })}
                data-testid="folder-create"
              >
                <FolderPlus aria-hidden />
                New folder
              </Button>
              <ImportBoardButton
                workspaceId={workspace.id}
                projectId={project.id}
                folderId={effectiveFolderId}
              />
              <Button
                size="sm"
                onClick={() => openNewBoard({ projectId: project.id, folderId: effectiveFolderId })}
              >
                <Plus aria-hidden />
                New board
              </Button>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Project actions"
                    data-testid="project-menu"
                  >
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'rename-project' })}>
                    <Pencil aria-hidden />
                    Rename project…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDialog({ kind: 'delete-project' })}
                  >
                    <Trash2 aria-hidden />
                    Delete project…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null
        }
      />

      {childFolders.length > 0 ? (
        <section aria-labelledby="folders-heading" className="grid gap-3">
          <h2 id="folders-heading" className="text-sm font-medium text-muted-foreground">
            Folders
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {childFolders.map((folder) => (
              <li
                key={folder.id}
                className="group flex items-center gap-2 rounded-lg border bg-card pr-1 transition-colors hover:border-foreground/15"
                data-testid="folder-item"
              >
                <button
                  type="button"
                  onClick={() => openFolder(folder.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{folder.name}</span>
                </button>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for folder ${folder.name}`}
                    >
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setDialog({ kind: 'rename', folder })}>
                      <Pencil aria-hidden />
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setDialog({ kind: 'delete', folder })}
                    >
                      <Trash2 aria-hidden />
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="project-boards-heading" className="grid gap-3">
        <h2 id="project-boards-heading" className="text-sm font-medium text-muted-foreground">
          Boards
        </h2>
        <BoardCollection
          label={`Boards in ${currentFolder?.name ?? project?.name ?? 'project'}`}
          boards={boardsHere}
          isLoading={boards.isPending || !project}
          isError={boards.isError}
          onRetry={() => void boards.refetch()}
          workspaceId={workspace.id}
          defaultSort="updated"
          emptyState={
            <EmptyState
              icon={<Folder />}
              title={currentFolder ? 'This folder is empty' : 'No boards in this project yet'}
              description="Create a board here, or move existing boards in from their menu."
              action={
                project ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      openNewBoard({ projectId: project.id, folderId: effectiveFolderId })
                    }
                  >
                    <Plus aria-hidden />
                    New board
                  </Button>
                ) : null
              }
            />
          }
        />
      </section>

      <RenameDialog
        open={dialog?.kind === 'create'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="New folder"
        label="Folder name"
        initialValue=""
        maxLength={120}
        submitLabel="Create folder"
        onSubmit={(name) =>
          folderMutations.create.mutateAsync({ name, projectId, parentId: effectiveFolderId })
        }
      />
      <RenameDialog
        open={dialog?.kind === 'rename'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Rename folder"
        label="Folder name"
        initialValue={dialog?.kind === 'rename' ? dialog.folder.name : ''}
        maxLength={120}
        onSubmit={(name) =>
          dialog?.kind === 'rename'
            ? folderMutations.update.mutateAsync({ folderId: dialog.folder.id, name })
            : Promise.resolve()
        }
      />
      <RenameDialog
        open={dialog?.kind === 'rename-project'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Rename project"
        label="Project name"
        initialValue={project?.name ?? ''}
        maxLength={120}
        onSubmit={(name) => projectMutations.rename.mutateAsync({ projectId, name })}
      />
      <AlertDialog
        open={dialog?.kind === 'delete' || dialog?.kind === 'delete-project'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog?.kind === 'delete'
                ? `Delete folder “${dialog.folder.name}”?`
                : `Delete project “${project?.name ?? ''}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.kind === 'delete'
                ? 'Boards and subfolders inside it move up one level. Nothing is deleted.'
                : 'Its boards move to the trash, where you can restore them.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                if (dialog?.kind === 'delete') {
                  const folder = dialog.folder;
                  folderMutations.remove.mutate(folder.id, {
                    onSuccess: () => {
                      if (effectiveFolderId === folder.id) openFolder(folder.parentId);
                    },
                  });
                } else if (dialog?.kind === 'delete-project') {
                  projectMutations.remove.mutate(projectId, {
                    onSuccess: () => navigate(`/w/${workspace.id}`),
                  });
                }
                setDialog(null);
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ViewContainer>
  );
}

export default ProjectView;
