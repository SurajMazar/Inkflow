import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { LinkIcon } from 'lucide-react';
import { Button } from '@inkflow/ui';
import { ApiError } from '@inkflow/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { setShareToken } from '@/lib/share-token';
import { useDocumentTitle } from '@/lib/use-document-title';
import { FullPageLoader, FullPageMessage } from '@/components/FullPageState';
import { useAuth } from '@/features/auth/AuthProvider';
import { describeApiError } from '@/features/notifications/notify';

/**
 * `/s/:token` — resolves a share link, remembers the token for the board (sessionStorage) and
 * opens the editor. Works for anonymous visitors.
 */
export function ShareLinkPage() {
  useDocumentTitle('Opening shared board');
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { status } = useAuth();
  const resolved = useQuery({
    queryKey: queryKeys.shareLinks.resolve(token),
    queryFn: ({ signal }) => api.sharing.resolveLink(token, { signal }),
    enabled: token.length > 0,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status > 0 && error.status < 500) && count < 2,
    staleTime: 0,
    gcTime: 0,
  });

  React.useEffect(() => {
    if (!resolved.data) return;
    setShareToken(resolved.data.boardId, token);
    navigate(`/b/${encodeURIComponent(resolved.data.boardId)}`, { replace: true });
  }, [resolved.data, token, navigate]);

  if (resolved.isError || !token) {
    const error = resolved.error;
    const unavailable =
      !token ||
      (error instanceof ApiError &&
        (error.code === 'NOT_FOUND' ||
          error.code === 'TOKEN_EXPIRED' ||
          error.code === 'TOKEN_INVALID'));
    const { title, description } = describeApiError(error);
    return (
      <FullPageMessage
        icon={
          <div className="flex size-11 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
            <LinkIcon className="size-5" aria-hidden />
          </div>
        }
        title={unavailable ? 'This link has expired or was revoked' : title}
        description={unavailable ? 'Ask the person who shared it for a new link.' : description}
        actions={
          <>
            {unavailable ? null : (
              <Button onClick={() => void resolved.refetch()}>Try again</Button>
            )}
            <Button asChild variant="outline">
              <Link to={status === 'authenticated' ? '/' : '/login'}>
                {status === 'authenticated' ? 'Go to your boards' : 'Sign in to Inkflow'}
              </Link>
            </Button>
          </>
        }
      />
    );
  }

  return <FullPageLoader label="Opening shared board…" />;
}

export default ShareLinkPage;
