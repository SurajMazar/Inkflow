import * as React from 'react';
import { Navigate, Outlet, useLocation, useParams, useSearchParams } from 'react-router';
import { getShareToken } from '@/lib/share-token';
import { ConnectionErrorPage, FullPageLoader } from '@/components/FullPageState';
import { useAuth } from './AuthProvider';
import { authRedirect, sanitizeNext } from './next-param';

function useLoginRedirect(): string {
  const location = useLocation();
  return authRedirect('/login', `${location.pathname}${location.search}${location.hash}`);
}

/** Renders children (or the nested route) only for signed-in users; otherwise → `/login?next=`. */
export function RequireAuth({ children }: { children?: React.ReactNode }) {
  const { status, bootError, refreshUser } = useAuth();
  const loginUrl = useLoginRedirect();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') {
    if (bootError && bootError.code === 'SERVICE_UNAVAILABLE') {
      return <ConnectionErrorPage onRetry={() => void refreshUser()} />;
    }
    return <Navigate to={loginUrl} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

/**
 * Guard for `/b/:boardId`: signed-in users, or anonymous visitors holding a share-link token for
 * this board (stored by the `/s/:token` page).
 */
export function RequireAuthOrShareToken({ children }: { children?: React.ReactNode }) {
  const { status, bootError, refreshUser } = useAuth();
  const { boardId } = useParams();
  const loginUrl = useLoginRedirect();
  const hasShareToken = boardId ? getShareToken(boardId) !== null : false;
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous' && !hasShareToken) {
    if (bootError && bootError.code === 'SERVICE_UNAVAILABLE') {
      return <ConnectionErrorPage onRetry={() => void refreshUser()} />;
    }
    return <Navigate to={loginUrl} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

/** For auth pages: signed-in users are sent to `?next=` (or the dashboard). */
export function RedirectIfAuthenticated({ children }: { children?: React.ReactNode }) {
  const { status } = useAuth();
  const [params] = useSearchParams();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to={sanitizeNext(params.get('next'))} replace />;
  return <>{children ?? <Outlet />}</>;
}
