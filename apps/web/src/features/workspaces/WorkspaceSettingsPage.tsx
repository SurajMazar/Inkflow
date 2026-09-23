import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { LogOut, MailPlus, Trash2, UserPlus, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  EmptyState,
  FormField,
  Input,
  NativeSelect,
  SimpleTooltip,
  Skeleton,
  Spinner,
  UserAvatar,
} from '@inkflow/ui';
import {
  workspaceRoleAtLeast,
  type WorkspaceDto,
  type WorkspaceMemberDto,
  type WorkspaceRole,
} from '@inkflow/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatDate, formatRelativeTime, formatRole, pluralize } from '@/lib/format';
import { useDocumentTitle } from '@/lib/use-document-title';
import { FullPageMessage } from '@/components/FullPageState';
import {
  assignableWorkspaceRoles,
  canManageMember,
  useDeleteWorkspace,
  useUpdateWorkspace,
  useWorkspace,
  useWorkspaceInvitations,
  useWorkspaceMemberMutations,
  useWorkspaceMembers,
} from './hooks';
import { InviteMemberDialog } from './InviteMemberDialog';

export function WorkspaceSettingsPage() {
  const { workspaceId = '' } = useParams();
  const workspaceQuery = useWorkspace(workspaceId);
  const workspace = workspaceQuery.data;
  useDocumentTitle(workspace ? `${workspace.name} settings` : 'Workspace settings');

  if (workspaceQuery.isError && !workspace) {
    return (
      <FullPageMessage
        title="Workspace not found"
        description="It may have been deleted, or you're no longer a member."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Workspace settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the name, members and invitations of this workspace.
        </p>
      </header>
      {!workspace ? (
        <div className="grid gap-4" aria-busy="true">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-10">
          <GeneralSection workspace={workspace} />
          <MembersSection workspace={workspace} />
          {workspaceRoleAtLeast(workspace.role, 'ADMIN') ? (
            <InvitationsSection workspace={workspace} />
          ) : null}
          <DangerZone workspace={workspace} />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
  labelledBy,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  labelledBy: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={labelledBy} className="text-base font-semibold">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function GeneralSection({ workspace }: { workspace: WorkspaceDto }) {
  const canEdit = workspaceRoleAtLeast(workspace.role, 'ADMIN');
  const [name, setName] = React.useState(workspace.name);
  const [error, setError] = React.useState<string | undefined>();
  const update = useUpdateWorkspace(workspace.id);
  React.useEffect(() => setName(workspace.name), [workspace.name]);
  const dirty = name.trim() !== workspace.name;

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give your workspace a name');
      return;
    }
    setError(undefined);
    update.mutate(trimmed);
  };

  return (
    <Section title="General" labelledBy="ws-general">
      <form onSubmit={onSubmit} className="grid gap-4 rounded-xl border p-5">
        <FormField
          label="Name"
          error={error}
          description={canEdit ? undefined : 'Only admins and owners can rename the workspace.'}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            disabled={!canEdit}
            data-testid="workspace-name-input"
          />
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">
            {pluralize(workspace.memberCount, 'member')} ·{' '}
            {pluralize(workspace.boardCount, 'board')} · created {formatDate(workspace.createdAt)}
          </p>
          {canEdit ? (
            <Button
              type="submit"
              size="sm"
              disabled={!dirty || update.isPending}
              data-testid="workspace-name-save"
            >
              {update.isPending ? <Spinner className="text-current" label={null} /> : null}
              Save
            </Button>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

function MembersSection({ workspace }: { workspace: WorkspaceDto }) {
  const { user } = useAuth();
  const members = useWorkspaceMembers(workspace.id);
  const { updateRole, remove } = useWorkspaceMemberMutations(workspace.id);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<WorkspaceMemberDto | null>(null);
  const canInvite = workspaceRoleAtLeast(workspace.role, 'ADMIN');
  const assignable = assignableWorkspaceRoles(workspace.role);
  const sorted = React.useMemo(() => {
    const rank: Record<WorkspaceRole, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
    return [...(members.data ?? [])].sort(
      (a, b) => rank[a.role] - rank[b.role] || a.user.name.localeCompare(b.user.name),
    );
  }, [members.data]);

  return (
    <Section
      title="Members"
      labelledBy="ws-members"
      description={members.data ? pluralize(members.data.length, 'person', 'people') : undefined}
      action={
        canInvite ? (
          <Button size="sm" onClick={() => setInviteOpen(true)} data-testid="workspace-invite-open">
            <UserPlus aria-hidden />
            Invite people
          </Button>
        ) : null
      }
    >
      <div className="overflow-hidden rounded-xl border">
        {members.isPending ? (
          <div className="grid gap-3 p-4" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : members.isError ? (
          <p className="p-4 text-sm text-muted-foreground">Couldn't load members.</p>
        ) : (
          <ul className="divide-y" aria-label="Workspace members">
            {sorted.map((member) => {
              const isMe = member.user.id === user?.id;
              const manageable = !isMe && canManageMember(workspace.role, member.role);
              return (
                <li
                  key={member.user.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                  data-testid="workspace-member"
                >
                  <UserAvatar
                    name={member.user.name}
                    src={member.user.avatarUrl}
                    className="size-8"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.user.name}
                      {isMe ? (
                        <span className="font-normal text-muted-foreground"> (you)</span>
                      ) : null}
                    </p>
                    <p className="truncate text-[13px] text-muted-foreground">
                      {member.user.email}
                    </p>
                  </div>
                  <span className="hidden text-[13px] text-muted-foreground sm:inline">
                    Joined {formatDate(member.joinedAt)}
                  </span>
                  {manageable && assignable.length > 0 ? (
                    <NativeSelect
                      aria-label={`Role for ${member.user.name}`}
                      value={member.role}
                      disabled={updateRole.isPending}
                      onChange={(e) =>
                        updateRole.mutate({
                          userId: member.user.id,
                          role: e.target.value as WorkspaceRole,
                        })
                      }
                      className="h-8 text-[13px]"
                    >
                      {(assignable.includes(member.role)
                        ? assignable
                        : [member.role, ...assignable]
                      ).map((role) => (
                        <option key={role} value={role}>
                          {formatRole(role)}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Badge variant={member.role === 'OWNER' ? 'subtle' : 'outline'}>
                      {formatRole(member.role)}
                    </Badge>
                  )}
                  {manageable ? (
                    <SimpleTooltip content="Remove from workspace">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${member.user.name}`}
                        onClick={() => setRemoving(member)}
                      >
                        <X aria-hidden />
                      </Button>
                    </SimpleTooltip>
                  ) : (
                    <span className="size-8 pointer-coarse:size-10" aria-hidden />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <InviteMemberDialog
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        myRole={workspace.role}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.user.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll lose access to this workspace and its boards, unless a board was shared with
              them directly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                removing && remove.mutate(removing.user.id, { onSettled: () => setRemoving(null) })
              }
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

function InvitationsSection({ workspace }: { workspace: WorkspaceDto }) {
  const invitations = useWorkspaceInvitations(workspace.id, true);
  const { revokeInvitation } = useWorkspaceMemberMutations(workspace.id);
  return (
    <Section
      title="Pending invitations"
      labelledBy="ws-invitations"
      description="Invitations that haven't been accepted yet."
    >
      {invitations.isPending ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : !invitations.data || invitations.data.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<MailPlus />}
          title="No pending invitations"
          description="Invite teammates by email from the Members section."
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border" aria-label="Pending invitations">
          {invitations.data.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
              data-testid="workspace-invitation"
            >
              <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <MailPlus className="size-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{invitation.email}</p>
                <p className="truncate text-[13px] text-muted-foreground">
                  Invited by {invitation.invitedBy.name} · expires{' '}
                  {formatRelativeTime(invitation.expiresAt)}
                </p>
              </div>
              <Badge variant="outline">{formatRole(invitation.role)}</Badge>
              <Button
                variant="ghost"
                size="sm"
                disabled={revokeInvitation.isPending}
                onClick={() => revokeInvitation.mutate(invitation.id)}
                data-testid="workspace-invitation-revoke"
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DangerZone({ workspace }: { workspace: WorkspaceDto }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const members = useWorkspaceMembers(workspace.id);
  const { leave } = useWorkspaceMemberMutations(workspace.id);
  const deleteWorkspace = useDeleteWorkspace(workspace.id);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const ownerCount = members.data?.filter((m) => m.role === 'OWNER').length ?? 0;
  const soleOwner = workspace.role === 'OWNER' && ownerCount <= 1;

  return (
    <Section title="Danger zone" labelledBy="ws-danger">
      <div className="divide-y overflow-hidden rounded-xl border border-destructive/30">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">Leave workspace</p>
            <p className="text-[13px] text-muted-foreground">
              {soleOwner
                ? 'Transfer ownership to another member before leaving.'
                : "You'll lose access to its boards."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={soleOwner}
            onClick={() => setConfirmLeave(true)}
            data-testid="workspace-leave"
          >
            <LogOut aria-hidden />
            Leave
          </Button>
        </div>
        {workspace.role === 'OWNER' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">Delete workspace</p>
              <p className="text-[13px] text-muted-foreground">
                Permanently deletes all projects, folders and boards.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              data-testid="workspace-delete"
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {workspace.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll need a new invitation to join again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={leave.isPending || !user}
              onClick={() =>
                user && leave.mutate(user.id, { onSuccess: () => navigate('/', { replace: true }) })
              }
            >
              Leave workspace
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          if (!open) setTyped('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {workspace.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the workspace with {pluralize(workspace.boardCount, 'board')}
              . This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormField
            label={
              <span>
                Type <span className="font-semibold">{workspace.name}</span> to confirm
              </span>
            }
          >
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              data-testid="workspace-delete-confirm-input"
            />
          </FormField>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={typed.trim() !== workspace.name || deleteWorkspace.isPending}
              onClick={() =>
                deleteWorkspace.mutate(undefined, {
                  onSuccess: () => navigate('/', { replace: true }),
                })
              }
              data-testid="workspace-delete-confirm"
            >
              {deleteWorkspace.isPending ? <Spinner className="text-current" label={null} /> : null}
              Delete workspace
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

export default WorkspaceSettingsPage;
