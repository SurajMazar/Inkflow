import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddBoardShareRequest,
  BoardDetailDto,
  BoardRole,
  BoardSharingDto,
  BoardSummaryDto,
  CreateShareLinkRequest,
  WorkspaceAccess,
} from '@inkflow/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/features/auth/AuthProvider';
import { notify, toastApiError } from '@/features/notifications/notify';

/** Looks up a board summary in the query cache (board detail or any board list). */
export function findCachedBoard(
  queryClient: ReturnType<typeof useQueryClient>,
  boardId: string,
): BoardSummaryDto | undefined {
  const detail = queryClient.getQueryData<BoardDetailDto>(queryKeys.boards.detail(boardId));
  if (detail?.board) return detail.board;
  for (const [, list] of queryClient.getQueriesData<BoardSummaryDto[]>({ queryKey: queryKeys.boards.lists })) {
    const found = list?.find((b) => b.id === boardId);
    if (found) return found;
  }
  return undefined;
}

/** Applies a partial update to the board in every cached list and in the detail entry. */
export function patchCachedBoard(
  queryClient: ReturnType<typeof useQueryClient>,
  boardId: string,
  patch: Partial<BoardSummaryDto>,
): void {
  queryClient.setQueriesData<BoardSummaryDto[]>({ queryKey: queryKeys.boards.lists }, (list) =>
    list?.map((b) => (b.id === boardId ? { ...b, ...patch } : b)),
  );
  queryClient.setQueryData<BoardDetailDto>(queryKeys.boards.detail(boardId), (detail) =>
    detail ? { ...detail, board: { ...detail.board, ...patch } } : detail,
  );
}

export interface UseBoardSharingOptions {
  /** Fetch only while true (e.g. while the dialog is open). Default true. */
  enabled?: boolean;
  /** The current user's role on the board, when already known (e.g. from the editor). */
  role?: BoardRole | null;
}

/**
 * Sharing state of a board (`GET /boards/:id/sharing`) plus every sharing mutation. Mutations
 * update the cached `BoardSharingDto` from the server response and toast on failure.
 */
export function useBoardSharing(boardId: string, options: UseBoardSharingOptions = {}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const key = queryKeys.boards.sharing(boardId);

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.sharing.get(boardId, { signal }),
    enabled: (options.enabled ?? true) && !!boardId,
  });

  const setSharing = (sharing: BoardSharingDto) => queryClient.setQueryData(key, sharing);
  const board = findCachedBoard(queryClient, boardId);
  const memberRole = query.data?.members.find((m) => m.user.id === user?.id)?.role;
  /** Effective role: explicit → cached board → own membership → EDITOR (sharing requires EDITOR+). */
  const myRole: BoardRole = options.role ?? board?.role ?? memberRole ?? 'EDITOR';
  const isOwner = myRole === 'OWNER';

  const invite = useMutation({
    mutationFn: (body: AddBoardShareRequest) => api.sharing.addShare(boardId, body),
    onSuccess: (sharing, body) => {
      setSharing(sharing);
      const added = sharing.members.some((m) => m.user.email.toLowerCase() === body.email.toLowerCase());
      notify.success(added ? 'Access granted' : 'Invitation sent', { description: body.email });
    },
  });

  const updateMemberRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: BoardRole }) =>
      api.sharing.updateMember(boardId, userId, { role }),
    onSuccess: setSharing,
    onError: (error) => toastApiError(error, "Couldn't change the role"),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.sharing.removeMember(boardId, userId),
    onSuccess: (sharing, userId) => {
      setSharing(sharing);
      if (userId === user?.id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.boards.lists });
        notify.success('You no longer have access to this board');
      }
    },
    onError: (error) => toastApiError(error, "Couldn't remove access"),
  });

  const revokeInvite = useMutation({
    mutationFn: (shareId: string) => api.sharing.revokeShare(boardId, shareId),
    onSuccess: (sharing) => {
      setSharing(sharing);
      notify.success('Invitation revoked');
    },
    onError: (error) => toastApiError(error, "Couldn't revoke the invitation"),
  });

  const setWorkspaceAccess = useMutation({
    mutationFn: (workspaceAccess: WorkspaceAccess) => api.boards.update(boardId, { workspaceAccess }),
    onMutate: (workspaceAccess) => {
      const previous = queryClient.getQueryData<BoardSharingDto>(key);
      if (previous) setSharing({ ...previous, workspaceAccess });
      return { previous };
    },
    onSuccess: (summary) => {
      patchCachedBoard(queryClient, boardId, summary);
      notify.success('General access updated');
    },
    onError: (error, _access, context) => {
      if (context?.previous) setSharing(context.previous);
      toastApiError(error, "Couldn't update access");
    },
  });

  const createLink = useMutation({
    mutationFn: (body: CreateShareLinkRequest) => api.sharing.createLink(boardId, body),
    onSuccess: (link) => {
      queryClient.setQueryData<BoardSharingDto>(key, (sharing) =>
        sharing ? { ...sharing, links: [link, ...sharing.links.filter((l) => l.id !== link.id)] } : sharing,
      );
    },
    onError: (error) => toastApiError(error, "Couldn't create the link"),
  });

  const revokeLink = useMutation({
    mutationFn: (linkId: string) => api.sharing.revokeLink(boardId, linkId),
    onSuccess: (_ok, linkId) => {
      queryClient.setQueryData<BoardSharingDto>(key, (sharing) =>
        sharing ? { ...sharing, links: sharing.links.filter((l) => l.id !== linkId) } : sharing,
      );
      notify.success('Link revoked', { description: 'People using it lose access immediately.' });
    },
    onError: (error) => toastApiError(error, "Couldn't revoke the link"),
  });

  return {
    sharing: query.data,
    query,
    board,
    myRole,
    isOwner,
    invite,
    updateMemberRole,
    removeMember,
    revokeInvite,
    setWorkspaceAccess,
    createLink,
    revokeLink,
  };
}

export type BoardSharingApi = ReturnType<typeof useBoardSharing>;
