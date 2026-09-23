import * as React from 'react';
import { Check, Copy, Globe, Link2, Lock, Trash2, Users, X } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Separator,
  SimpleTooltip,
  Skeleton,
  Spinner,
  Textarea,
  UserAvatar,
} from '@inkflow/ui';
import {
  ApiError,
  addBoardShareSchema,
  boardRoleAtLeast,
  type BoardRole,
  type ShareLinkDto,
  type ShareLinkRole,
  type WorkspaceAccess,
} from '@inkflow/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { describeApiError, notify } from '@/features/notifications/notify';
import { copyToClipboard } from '@/lib/clipboard';
import { formatRelativeTime, formatRole } from '@/lib/format';
import { useBoardSharing, type BoardSharingApi } from './useBoardSharing';

export interface ShareDialogProps {
  boardId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Current user's role on the board when known (otherwise resolved from caches). */
  role?: BoardRole | null;
  /** Board title shown in the header when known. */
  boardTitle?: string;
}

export const LINK_EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never expires', hours: undefined },
  { value: '24', label: 'Expires in 1 day', hours: 24 },
  { value: '168', label: 'Expires in 7 days', hours: 24 * 7 },
  { value: '720', label: 'Expires in 30 days', hours: 24 * 30 },
] as const;

const WORKSPACE_ACCESS_LABELS: Record<WorkspaceAccess, { label: string; description: string }> = {
  NONE: { label: 'Only people invited', description: 'Workspace members need an invitation.' },
  VIEWER: { label: 'Workspace can view', description: 'Everyone in the workspace can open and comment.' },
  EDITOR: { label: 'Workspace can edit', description: 'Everyone in the workspace can edit.' },
};

/**
 * Board sharing dialog: invite people, manage member roles and pending invites, workspace access
 * and share links. Safe to mount closed — nothing is fetched until it opens.
 */
export function ShareDialog({ boardId, open, onOpenChange, role, boardTitle }: ShareDialogProps) {
  const sharingApi = useBoardSharing(boardId, { enabled: open, role });
  const title = boardTitle ?? sharingApi.board?.title;
  const { query } = sharingApi;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl" data-testid="share-dialog">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="truncate">{title ? `Share “${title}”` : 'Share board'}</DialogTitle>
          <DialogDescription>Invite people, set general access or create a link.</DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <div className="grid gap-3 px-6 pb-6" aria-busy="true" aria-label="Loading sharing settings">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : query.isError ? (
          <div className="px-6 pb-6 text-sm text-muted-foreground" role="alert">
            {query.error instanceof ApiError && (query.error.code === 'FORBIDDEN' || query.error.code === 'NOT_FOUND')
              ? 'You need edit access to share this board.'
              : describeApiError(query.error, "Couldn't load sharing settings").title}
          </div>
        ) : (
          <div className="grid gap-5 px-6 pb-6">
            <InviteForm sharingApi={sharingApi} />
            <PeopleList sharingApi={sharingApi} />
            <Separator />
            <GeneralAccess sharingApi={sharingApi} />
            <Separator />
            <ShareLinks sharingApi={sharingApi} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ sharingApi }: { sharingApi: BoardSharingApi }) {
  const { invite, myRole } = sharingApi;
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<'EDITOR' | 'VIEWER'>(boardRoleAtLeast(myRole, 'EDITOR') ? 'EDITOR' : 'VIEWER');
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const errorId = React.useId();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = addBoardShareSchema.safeParse({ email, role, message: message.trim() || undefined });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    invite.mutate(parsed.data, {
      onSuccess: () => {
        setEmail('');
        setMessage('');
      },
      onError: (err) =>
        setError(
          err instanceof ApiError && (err.code === 'CONFLICT' || err.code === 'VALIDATION_FAILED')
            ? err.message
            : describeApiError(err, "Couldn't share the board").title,
        ),
    });
  };

  return (
    <form className="grid gap-2" onSubmit={onSubmit} noValidate aria-label="Invite people">
      <Label htmlFor="share-invite-email" className="sr-only">
        Email address
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="share-invite-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="Add people by email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="flex-1"
          data-testid="share-invite-email"
        />
        <div className="flex gap-2">
          <NativeSelect
            aria-label="Role for invited people"
            value={role}
            onChange={(e) => setRole(e.target.value as 'EDITOR' | 'VIEWER')}
            data-testid="share-invite-role"
            wrapperClassName="flex-1 sm:flex-none"
          >
            {boardRoleAtLeast(myRole, 'EDITOR') ? <option value="EDITOR">Can edit</option> : null}
            <option value="VIEWER">Can view</option>
          </NativeSelect>
          <Button type="submit" disabled={invite.isPending} data-testid="share-invite-submit">
            {invite.isPending ? <Spinner className="text-current" label={null} /> : null}
            Invite
          </Button>
        </div>
      </div>
      {email.includes('@') ? (
        <Textarea
          aria-label="Message (optional)"
          placeholder="Add a message (optional)"
          value={message}
          maxLength={500}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-14 text-sm"
          data-testid="share-invite-message"
        />
      ) : null}
      <p id={errorId} aria-live="polite" className={error ? 'text-[13px] font-medium text-destructive' : 'sr-only'}>
        {error}
      </p>
    </form>
  );
}

function PeopleList({ sharingApi }: { sharingApi: BoardSharingApi }) {
  const { user } = useAuth();
  const { sharing, isOwner, updateMemberRole, removeMember, revokeInvite } = sharingApi;
  if (!sharing) return null;
  const members = [...sharing.members].sort((a, b) => {
    const rank: Record<BoardRole, number> = { OWNER: 0, EDITOR: 1, VIEWER: 2 };
    return rank[a.role] - rank[b.role] || a.user.name.localeCompare(b.user.name);
  });

  return (
    <section aria-labelledby="share-people-heading" className="grid gap-2">
      <h3 id="share-people-heading" className="text-[13px] font-medium text-muted-foreground">
        People with access
      </h3>
      <ul className="-mx-2 grid max-h-64 gap-0.5 overflow-y-auto" data-testid="share-members">
        {members.map((member) => {
          const isMe = member.user.id === user?.id;
          const canChange = isOwner && !isMe;
          return (
            <li key={member.user.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5" data-testid="share-member">
              <UserAvatar name={member.user.name} src={member.user.avatarUrl} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.user.name}
                  {isMe ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                </p>
                <p className="truncate text-[13px] text-muted-foreground">{member.user.email}</p>
              </div>
              {canChange ? (
                <NativeSelect
                  aria-label={`Role for ${member.user.name}`}
                  value={member.role}
                  disabled={updateMemberRole.isPending}
                  onChange={(e) => updateMemberRole.mutate({ userId: member.user.id, role: e.target.value as BoardRole })}
                  className="h-8 text-[13px]"
                  data-testid="share-member-role"
                >
                  <option value="OWNER">Owner</option>
                  <option value="EDITOR">Can edit</option>
                  <option value="VIEWER">Can view</option>
                </NativeSelect>
              ) : (
                <span className="text-[13px] text-muted-foreground">
                  {member.role === 'OWNER' ? 'Owner' : member.role === 'EDITOR' ? 'Can edit' : 'Can view'}
                </span>
              )}
              {canChange || (isMe && member.role !== 'OWNER') ? (
                <SimpleTooltip content={isMe ? 'Leave board' : 'Remove access'}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={isMe ? 'Leave board' : `Remove ${member.user.name}`}
                    disabled={removeMember.isPending}
                    onClick={() => removeMember.mutate(member.user.id)}
                    data-testid="share-member-remove"
                  >
                    <X aria-hidden />
                  </Button>
                </SimpleTooltip>
              ) : (
                <span className="size-8 shrink-0 pointer-coarse:size-10" aria-hidden />
              )}
            </li>
          );
        })}
        {sharing.pending.map((pending) => (
          <li key={pending.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5" data-testid="share-pending">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground">
              <Users className="size-3.5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{pending.email}</p>
              <p className="truncate text-[13px] text-muted-foreground">
                Invited by {pending.invitedBy.name} · {formatRelativeTime(pending.createdAt)}
              </p>
            </div>
            <Badge variant="outline">Pending · {formatRole(pending.role)}</Badge>
            <SimpleTooltip content="Revoke invitation">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Revoke invitation for ${pending.email}`}
                disabled={revokeInvite.isPending}
                onClick={() => revokeInvite.mutate(pending.id)}
                data-testid="share-pending-revoke"
              >
                <X aria-hidden />
              </Button>
            </SimpleTooltip>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GeneralAccess({ sharingApi }: { sharingApi: BoardSharingApi }) {
  const { sharing, isOwner, setWorkspaceAccess } = sharingApi;
  if (!sharing) return null;
  const current = WORKSPACE_ACCESS_LABELS[sharing.workspaceAccess];
  const Icon = sharing.workspaceAccess === 'NONE' ? Lock : Globe;
  return (
    <section aria-labelledby="share-access-heading" className="grid gap-2">
      <h3 id="share-access-heading" className="text-[13px] font-medium text-muted-foreground">
        General access
      </h3>
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          {isOwner ? (
            <NativeSelect
              aria-label="Workspace access"
              value={sharing.workspaceAccess}
              disabled={setWorkspaceAccess.isPending}
              onChange={(e) => setWorkspaceAccess.mutate(e.target.value as WorkspaceAccess)}
              className="h-8 border-transparent pl-1 font-medium shadow-none hover:bg-accent"
              data-testid="share-workspace-access"
            >
              {(Object.keys(WORKSPACE_ACCESS_LABELS) as WorkspaceAccess[]).map((access) => (
                <option key={access} value={access}>
                  {WORKSPACE_ACCESS_LABELS[access].label}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <p className="text-sm font-medium">{current.label}</p>
          )}
          <p className="text-[13px] text-muted-foreground">
            {current.description}
            {!isOwner ? ' Only the owner can change this.' : ''}
          </p>
        </div>
      </div>
    </section>
  );
}

function linkMeta(link: ShareLinkDto): string {
  const expiry = link.expiresAt
    ? Date.parse(link.expiresAt) < Date.now()
      ? 'Expired'
      : `Expires ${formatRelativeTime(link.expiresAt)}`
    : 'Never expires';
  const used = link.lastUsedAt ? `last used ${formatRelativeTime(link.lastUsedAt)}` : 'not used yet';
  return `${expiry} · ${used}`;
}

function ShareLinks({ sharingApi }: { sharingApi: BoardSharingApi }) {
  const { sharing, createLink, revokeLink, myRole } = sharingApi;
  const [role, setRole] = React.useState<ShareLinkRole>('VIEWER');
  const [expiry, setExpiry] = React.useState<(typeof LINK_EXPIRY_OPTIONS)[number]['value']>('never');
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState('');

  React.useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  if (!sharing) return null;

  const copy = async (link: ShareLinkDto) => {
    const ok = await copyToClipboard(link.url);
    if (ok) {
      setCopiedId(link.id);
      setStatus('Link copied to clipboard');
    } else {
      notify.error("Couldn't copy the link", { description: 'Select the link and copy it manually.' });
    }
  };

  const create = () => {
    const hours = LINK_EXPIRY_OPTIONS.find((o) => o.value === expiry)?.hours;
    createLink.mutate(
      { role, ...(hours ? { expiresInHours: hours } : {}) },
      {
        onSuccess: async (link) => {
          const ok = await copyToClipboard(link.url);
          if (ok) setCopiedId(link.id);
          notify.success(ok ? 'Link created and copied' : 'Link created');
          setStatus(ok ? 'Link created and copied to clipboard' : 'Link created');
        },
      },
    );
  };

  return (
    <section aria-labelledby="share-links-heading" className="grid gap-3">
      <div>
        <h3 id="share-links-heading" className="text-[13px] font-medium text-muted-foreground">
          Share links
        </h3>
        <p className="text-[13px] text-muted-foreground">Anyone with a link can open the board — no account needed.</p>
      </div>
      {sharing.links.length > 0 ? (
        <ul className="grid gap-2" data-testid="share-links">
          {sharing.links.map((link) => (
            <li key={link.id} className="grid gap-1.5 rounded-lg border p-2.5" data-testid="share-link">
              <div className="flex items-center gap-2">
                <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Input
                  readOnly
                  value={link.url}
                  aria-label={`${link.role === 'EDITOR' ? 'Edit' : 'View'} link`}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 flex-1 font-mono text-xs"
                  data-testid="share-link-url"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copy(link)}
                  aria-label={copiedId === link.id ? 'Copied' : 'Copy link'}
                  data-testid="share-link-copy"
                >
                  {copiedId === link.id ? <Check aria-hidden /> : <Copy aria-hidden />}
                  <span className="hidden sm:inline">{copiedId === link.id ? 'Copied' : 'Copy'}</span>
                </Button>
                <SimpleTooltip content="Revoke link">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Revoke link"
                    disabled={revokeLink.isPending}
                    onClick={() => revokeLink.mutate(link.id)}
                    data-testid="share-link-revoke"
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </SimpleTooltip>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-6 text-xs text-muted-foreground">
                <Badge variant={link.role === 'EDITOR' ? 'subtle' : 'secondary'}>
                  {link.role === 'EDITOR' ? 'Can edit' : 'Can view'}
                </Badge>
                <span>{linkMeta(link)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <NativeSelect
          aria-label="Link permission"
          value={role}
          onChange={(e) => setRole(e.target.value as ShareLinkRole)}
          data-testid="share-link-role"
          wrapperClassName="sm:flex-1"
        >
          <option value="VIEWER">Anyone with the link can view</option>
          {boardRoleAtLeast(myRole, 'EDITOR') ? <option value="EDITOR">Anyone with the link can edit</option> : null}
        </NativeSelect>
        <NativeSelect
          aria-label="Link expiry"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value as typeof expiry)}
          data-testid="share-link-expiry"
        >
          {LINK_EXPIRY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        <Button variant="secondary" onClick={create} disabled={createLink.isPending} data-testid="share-link-create">
          {createLink.isPending ? <Spinner className="text-current" label={null} /> : <Link2 aria-hidden />}
          Create link
        </Button>
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

export default ShareDialog;
