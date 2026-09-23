import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type {
  BoardSummaryDto,
  CreateBoardRequest,
  CreateFolderRequest,
  FolderDto,
  ListBoardsQuery,
  ProjectDto,
  WorkspaceDto,
} from '@inkflow/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { notify, toastApiError } from '@/features/notifications/notify';
import { patchCachedBoard } from '@/features/sharing/useBoardSharing';

/* ─────────────────────────────── queries ─────────────────────────────── */

export function useBoards(query: ListBoardsQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.boards.list(query),
    queryFn: ({ signal }) => api.boards.list(query, { signal }),
    enabled: options.enabled ?? true,
  });
}

export function useProjects(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.workspaces.projects(workspaceId),
    queryFn: ({ signal }) => api.projects.list(workspaceId, { signal }),
    enabled: !!workspaceId,
  });
}

export function useFolders(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.workspaces.folders(workspaceId),
    queryFn: ({ signal }) => api.folders.list(workspaceId, { signal }),
    enabled: !!workspaceId,
  });
}

export function useTemplates(workspaceId: string | null) {
  return useQuery({
    queryKey: queryKeys.templates.list(workspaceId),
    queryFn: ({ signal }) => api.templates.list(workspaceId ?? undefined, { signal }),
    staleTime: 5 * 60_000,
  });
}

/* ────────────────────────── project & folder mutations ────────────────────────── */

export function useProjectMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.workspaces.projects(workspaceId);
  const create = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      api.projects.create(workspaceId, body),
    onSuccess: (project) => {
      queryClient.setQueryData<ProjectDto[]>(key, (list) =>
        list ? [...list, project] : [project],
      );
      notify.success(`Created project ${project.name}`);
    },
    onError: (error) => toastApiError(error, "Couldn't create the project"),
  });
  const rename = useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
      api.projects.update(projectId, { name }),
    onSuccess: (project) => {
      queryClient.setQueryData<ProjectDto[]>(key, (list) =>
        list?.map((p) => (p.id === project.id ? project : p)),
      );
      notify.success('Project renamed');
    },
    onError: (error) => toastApiError(error, "Couldn't rename the project"),
  });
  const remove = useMutation({
    mutationFn: (projectId: string) => api.projects.remove(projectId),
    onSuccess: (_ok, projectId) => {
      queryClient.setQueryData<ProjectDto[]>(key, (list) =>
        list?.filter((p) => p.id !== projectId),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.folders(workspaceId) });
      notify.success('Project deleted', { description: 'Its boards were moved to the trash.' });
    },
    onError: (error) => toastApiError(error, "Couldn't delete the project"),
  });
  return { create, rename, remove };
}

export function useFolderMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.workspaces.folders(workspaceId);
  const create = useMutation({
    mutationFn: (body: CreateFolderRequest) => api.folders.create(workspaceId, body),
    onSuccess: (folder) => {
      queryClient.setQueryData<FolderDto[]>(key, (list) => (list ? [...list, folder] : [folder]));
      notify.success(`Created folder ${folder.name}`);
    },
    onError: (error) => toastApiError(error, "Couldn't create the folder"),
  });
  const update = useMutation({
    mutationFn: ({
      folderId,
      name,
      parentId,
    }: {
      folderId: string;
      name?: string;
      parentId?: string | null;
    }) => api.folders.update(folderId, { name, parentId }),
    onSuccess: (folder) => {
      queryClient.setQueryData<FolderDto[]>(key, (list) =>
        list?.map((f) => (f.id === folder.id ? folder : f)),
      );
      notify.success('Folder updated');
    },
    onError: (error) => toastApiError(error, "Couldn't update the folder"),
  });
  const remove = useMutation({
    mutationFn: (folderId: string) => api.folders.remove(folderId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: queryKeys.boards.lists });
      notify.success('Folder deleted', { description: 'Its boards moved up one level.' });
    },
    onError: (error) => toastApiError(error, "Couldn't delete the folder"),
  });
  return { create, update, remove };
}

/* ───────────────────────────── board mutations ───────────────────────────── */

function adjustWorkspaceBoardCount(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  delta: number,
) {
  const update = (w: WorkspaceDto) =>
    w.id === workspaceId ? { ...w, boardCount: Math.max(0, w.boardCount + delta) } : w;
  queryClient.setQueryData<WorkspaceDto[]>(queryKeys.workspaces.list, (list) => list?.map(update));
  queryClient.setQueryData<WorkspaceDto>(queryKeys.workspaces.detail(workspaceId), (w) =>
    w ? update(w) : w,
  );
}

/** Every dashboard board action, with optimistic cache updates and toasts. */
export function useBoardMutations() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const invalidateLists = () => queryClient.invalidateQueries({ queryKey: queryKeys.boards.lists });
  const invalidateProjects = (workspaceId: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.projects(workspaceId) });

  const create = useMutation({
    mutationFn: (body: CreateBoardRequest) => api.boards.create(body),
    onSuccess: (board) => {
      adjustWorkspaceBoardCount(queryClient, board.workspaceId, 1);
      void invalidateLists();
      void invalidateProjects(board.workspaceId);
    },
  });

  const rename = useMutation({
    mutationFn: ({ board, title }: { board: BoardSummaryDto; title: string }) =>
      api.boards.update(board.id, { title }),
    onSuccess: (updated) => {
      patchCachedBoard(queryClient, updated.id, updated);
      notify.success('Board renamed');
    },
  });

  const toggleFavorite = useMutation({
    mutationFn: (board: BoardSummaryDto) => api.boards.setFavorite(board.id, !board.isFavorite),
    onMutate: (board) => {
      patchCachedBoard(queryClient, board.id, { isFavorite: !board.isFavorite });
    },
    onError: (error, board) => {
      patchCachedBoard(queryClient, board.id, { isFavorite: board.isFavorite });
      toastApiError(error, "Couldn't update favorites");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.boards.lists,
        predicate: (q) =>
          (q.queryKey[2] as { filter?: string } | undefined)?.filter === 'favorites',
      });
    },
  });

  const move = useMutation({
    mutationFn: ({
      board,
      projectId,
      folderId,
    }: {
      board: BoardSummaryDto;
      projectId: string | null;
      folderId: string | null;
    }) => api.boards.update(board.id, { projectId, folderId }),
    onSuccess: (updated) => {
      patchCachedBoard(queryClient, updated.id, updated);
      void invalidateLists();
      void invalidateProjects(updated.workspaceId);
      notify.success('Board moved');
    },
  });

  const duplicate = useMutation({
    mutationFn: (board: BoardSummaryDto) => api.boards.duplicate(board.id),
    onSuccess: (copy) => {
      adjustWorkspaceBoardCount(queryClient, copy.workspaceId, 1);
      void invalidateLists();
      void invalidateProjects(copy.workspaceId);
      notify.success('Board duplicated', {
        description: copy.title,
        action: { label: 'Open', onClick: () => navigate(`/b/${copy.id}`) },
      });
    },
    onError: (error) => toastApiError(error, "Couldn't duplicate the board"),
  });

  const restore = useMutation({
    mutationFn: (board: BoardSummaryDto) => api.boards.restore(board.id),
    onMutate: (board) => {
      queryClient.setQueriesData<BoardSummaryDto[]>(
        {
          queryKey: queryKeys.boards.lists,
          predicate: (q) => (q.queryKey[2] as { filter?: string } | undefined)?.filter === 'trash',
        },
        (list) => list?.filter((b) => b.id !== board.id),
      );
    },
    onSuccess: (restored) => {
      adjustWorkspaceBoardCount(queryClient, restored.workspaceId, 1);
      notify.success('Board restored', {
        description: restored.title,
        action: { label: 'Open', onClick: () => navigate(`/b/${restored.id}`) },
      });
    },
    onError: (error) => toastApiError(error, "Couldn't restore the board"),
    onSettled: (_data, _error, board) => {
      void invalidateLists();
      void invalidateProjects(board.workspaceId);
    },
  });

  const trash = useMutation({
    mutationFn: (board: BoardSummaryDto) => api.boards.remove(board.id),
    onMutate: (board) => {
      queryClient.setQueriesData<BoardSummaryDto[]>({ queryKey: queryKeys.boards.lists }, (list) =>
        list?.filter((b) => b.id !== board.id),
      );
    },
    onSuccess: (_ok, board) => {
      adjustWorkspaceBoardCount(queryClient, board.workspaceId, -1);
      notify.success('Moved to trash', {
        description: board.title,
        action: { label: 'Undo', onClick: () => restore.mutate(board) },
      });
    },
    onError: (error) => toastApiError(error, "Couldn't move the board to the trash"),
    onSettled: (_data, _error, board) => {
      void invalidateLists();
      void invalidateProjects(board.workspaceId);
    },
  });

  const deleteForever = useMutation({
    mutationFn: (board: BoardSummaryDto) => api.boards.removePermanently(board.id),
    onMutate: (board) => {
      queryClient.setQueriesData<BoardSummaryDto[]>({ queryKey: queryKeys.boards.lists }, (list) =>
        list?.filter((b) => b.id !== board.id),
      );
    },
    onSuccess: () => notify.success('Board deleted permanently'),
    onError: (error) => toastApiError(error, "Couldn't delete the board"),
    onSettled: () => void invalidateLists(),
  });

  const emptyTrash = useMutation({
    mutationFn: (workspaceId: string) => api.boards.emptyTrash(workspaceId),
    onSuccess: ({ deleted }) =>
      notify.success(
        deleted === 0
          ? 'Trash is already empty'
          : `Deleted ${deleted} board${deleted === 1 ? '' : 's'} permanently`,
      ),
    onError: (error) => toastApiError(error, "Couldn't empty the trash"),
    onSettled: () => void invalidateLists(),
  });

  return {
    create,
    rename,
    toggleFavorite,
    move,
    duplicate,
    trash,
    restore,
    deleteForever,
    emptyTrash,
  };
}
