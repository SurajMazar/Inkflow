import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { Button, Skeleton, Spinner } from '@inkflow/ui';
import { ApiError } from '@inkflow/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatRelativeTime, formatRole } from '@/lib/format';
import { useDocumentTitle } from '@/lib/use-document-title';
import { FullPageMessage } from '@/components/FullPageState';
import { describeApiError, notify, toastApiError } from '@/features/notifications/notify';
import { useAuth } from '../AuthProvider';
import { AuthLayout } from '../AuthLayout';

export function InviteAcceptPage() {
  useDocumentTitle('Workspace invitation');
  const { token = '' } = useParams();
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const next = `/invite/${encodeURIComponent(token)}`;

  const preview = useQuery({
    queryKey: queryKeys.invitations.preview(token),
    queryFn: ({ signal }) => api.invitations.preview(token, { signal }),
    enabled: token.length > 0,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.invitations.accept(token),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      notify.success(`You joined ${workspace.name}`);
      navigate(`/w/${workspace.id}`, { replace: true });
    },
    onError: (error) => toastApiError(error, "Couldn't accept the invitation"),
  });

  if (preview.isError) {
    const error = preview.error;
    const gone =
      error instanceof ApiError &&
      ['NOT_FOUND', 'TOKEN_EXPIRED', 'TOKEN_INVALID'].includes(error.code);
    return (
      <FullPageMessage
        title={gone ? 'This invitation is no longer valid' : describeApiError(error).title}
        description={
          gone
            ? 'It may have expired, been revoked or already been used. Ask a workspace admin to send a new one.'
            : describeApiError(error).description
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/">Go to Inkflow</Link>
          </Button>
        }
      />
    );
  }

  const invitation = preview.data;
  const emailMismatch = !!(
    user &&
    invitation &&
    user.email.toLowerCase() !== invitation.email.toLowerCase()
  );

  return (
    <AuthLayout
      title={invitation ? `Join ${invitation.workspaceName}` : 'Workspace invitation'}
      description={
        invitation ? (
          <>
            {invitation.invitedBy} invited you to collaborate as{' '}
            {formatRole(invitation.role).toLowerCase() === 'admin' ? 'an' : 'a'}{' '}
            <span className="font-medium text-foreground">{formatRole(invitation.role)}</span>.
          </>
        ) : undefined
      }
    >
      {!invitation || status === 'loading' ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <div className="grid gap-5">
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-brand-subtle text-brand-subtle-foreground">
              <Users className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">{invitation.workspaceName}</p>
              <p className="truncate text-muted-foreground">
                Sent to {invitation.email} · expires {formatRelativeTime(invitation.expiresAt)}
              </p>
            </div>
          </div>

          {status === 'anonymous' ? (
            <div className="grid gap-2">
              <Button asChild>
                <Link
                  to={`/login?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invitation.email)}`}
                >
                  Sign in to accept
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link
                  to={`/register?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invitation.email)}`}
                >
                  Create an account
                </Link>
              </Button>
            </div>
          ) : emailMismatch ? (
            <div className="grid gap-3 text-sm">
              <p className="text-muted-foreground" role="alert">
                This invitation was sent to{' '}
                <span className="font-medium text-foreground">{invitation.email}</span>, but you're
                signed in as <span className="font-medium text-foreground">{user?.email}</span>.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  void logout().then(() =>
                    navigate(
                      `/login?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invitation.email)}`,
                    ),
                  );
                }}
              >
                Switch account
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => accept.mutate()}
              disabled={accept.isPending}
              data-testid="invite-accept"
            >
              {accept.isPending ? <Spinner className="text-current" label={null} /> : null}
              Accept invitation
            </Button>
          )}
        </div>
      )}
    </AuthLayout>
  );
}

export default InviteAcceptPage;
