import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  workspaceRoleAtLeast,
  type CreateWorkspaceRequest,
  type InviteMemberRequest,
  type WorkspaceDto,
  type WorkspaceMemberDto,
  type WorkspaceRole,
} from '@inkflow/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/features/auth/AuthProvider';
import { notify, toastApiError } from '@/features/notifications/notify';
import { clearLastWorkspaceId, getLastWorkspaceId } from './last-workspace';

/** Workspaces the current user belongs to. */
export function useWorkspaces() {
  const { status } = useAuth();
  return useQuery({
    queryKey: queryKeys.workspaces.list,
    queryFn: ({ signal }) => api.workspaces.list({ signal }),
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
}

/** A single workspace (seeded from the list cache when available). */
export function useWorkspace(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.workspaces.detail(workspaceId ?? ''),
    queryFn: ({ signal }) => api.workspaces.get(workspaceId!, { signal }),
    enabled: !!workspaceId,
    initialData: () =>
      queryClient.getQueryData<WorkspaceDto[]>(queryKeys.workspaces.list)?.find((w) => w.id === workspaceId),
    initialDataUpdatedAt: () => queryClient.getQueryState(queryKeys.workspaces.list)?.dataUpdatedAt,
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkspaceRequest) => api.workspaces.create(body),
    onSuccess: (workspace) => {
      queryClient.setQueryData<WorkspaceDto[]>(queryKeys.workspaces.list, (list) =>
        list ? [...list.filter((w) => w.id !== workspace.id), workspace] : [workspace],
      );
      queryClient.setQueryData(queryKeys.workspaces.detail(workspace.id), workspace);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.list });
    },
  });
}

export function useUpdateWorkspace(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.workspaces.update(workspaceId, { name }),
    onSuccess: (workspace) => {
      queryClient.setQueryData(queryKeys.workspaces.detail(workspaceId), workspace);
      queryClient.setQueryData<WorkspaceDto[]>(queryKeys.workspaces.list, (list) =>
        list?.map((w) => (w.id === workspace.id ? workspace : w)),
      );
      notify.success('Workspace renamed');
    },
    onError: (error) => toastApiError(error, "Couldn't rename the workspace"),
  });
}

/** Removes the workspace from caches after it was deleted or left. */
function useForgetWorkspace() {
  const queryClient = useQueryClient();
  return (workspaceId: string) => {
    queryClient.setQueryData<WorkspaceDto[]>(queryKeys.workspaces.list, (list) => list?.filter((w) => w.id !== workspaceId));
    queryClient.removeQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.list });
    void queryClient.invalidateQueries({ queryKey: queryKeys.boards.all });
    if (getLastWorkspaceId() === workspaceId) clearLastWorkspaceId();
  };
}

export function useDeleteWorkspace(workspaceId: string) {
  const forget = useForgetWorkspace();
  return useMutation({
    mutationFn: () => api.workspaces.remove(workspaceId),
    onSuccess: () => {
      forget(workspaceId);
      notify.success('Workspace deleted');
    },
    onError: (error) => toastApiError(error, "Couldn't delete the workspace"),
  });
}

export function useWorkspaceMembers(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.workspaces.members(workspaceId),
    queryFn: ({ signal }) => api.workspaces.members(workspaceId, { signal }),
  });
}

export function useWorkspaceInvitations(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.workspaces.invitations(workspaceId),
    queryFn: ({ signal }) => api.workspaces.invitations(workspaceId, { signal }),
    enabled,
  });
}

export function useWorkspaceMemberMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const forget = useForgetWorkspace();
  const membersKey = queryKeys.workspaces.members(workspaceId);

  const updateRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      api.workspaces.updateMember(workspaceId, userId, { role }),
    onSuccess: (member) => {
      queryClient.setQueryData<WorkspaceMemberDto[]>(membersKey, (list) =>
        list?.map((m) => (m.user.id === member.user.id ? member : m)),
      );
      notify.success(`${member.user.name} is now ${member.role.toLowerCase() === 'admin' ? 'an' : 'a'} ${member.role.toLowerCase()}`);
    },
    onError: (error) => {
      toastApiError(error, "Couldn't change the role");
      void queryClient.invalidateQueries({ queryKey: membersKey });
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.workspaces.removeMember(workspaceId, userId),
    onSuccess: (_ok, userId) => {
      queryClient.setQueryData<WorkspaceMemberDto[]>(membersKey, (list) => list?.filter((m) => m.user.id !== userId));
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) });
      notify.success('Member removed');
    },
    onError: (error) => toastApiError(error, "Couldn't remove the member"),
  });

  const leave = useMutation({
    mutationFn: (userId: string) => api.workspaces.removeMember(workspaceId, userId),
    onSuccess: () => {
      forget(workspaceId);
      notify.success('You left the workspace');
    },
    onError: (error) => toastApiError(error, "Couldn't leave the workspace"),
  });

  const invite = useMutation({
    mutationFn: (body: InviteMemberRequest) => api.workspaces.invite(workspaceId, body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: membersKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.invitations(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) });
      if (result.status === 'added') notify.success(`${result.member?.user.name ?? 'They'} joined the workspace`);
      else notify.success('Invitation sent', { description: result.invitation?.email });
    },
  });

  const revokeInvitation = useMutation({
    mutationFn: (invitationId: string) => api.workspaces.revokeInvitation(workspaceId, invitationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.invitations(workspaceId) });
      notify.success('Invitation revoked');
    },
    onError: (error) => toastApiError(error, "Couldn't revoke the invitation"),
  });

  return { updateRole, remove, leave, invite, revokeInvitation };
}

/** Roles the current user may assign to other members. */
export function assignableWorkspaceRoles(myRole: WorkspaceRole): WorkspaceRole[] {
  if (myRole === 'OWNER') return ['OWNER', 'ADMIN', 'MEMBER'];
  if (workspaceRoleAtLeast(myRole, 'ADMIN')) return ['ADMIN', 'MEMBER'];
  return [];
}

/** Whether `me` may change the role of / remove `target`. */
export function canManageMember(myRole: WorkspaceRole, targetRole: WorkspaceRole): boolean {
  if (myRole === 'OWNER') return true;
  if (myRole === 'ADMIN') return targetRole !== 'OWNER';
  return false;
}
