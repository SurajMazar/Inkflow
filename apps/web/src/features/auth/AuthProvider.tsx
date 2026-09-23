import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  type LoginRequest,
  type RegisterRequest,
  type RegisterResponse,
  type UpdateMeRequest,
  type UserDto,
} from '@inkflow/shared';
import { api, ensureCsrfToken, onSessionExpired, onSessionRefreshed } from '@/lib/api';
import { shouldRetryQuery } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  user: UserDto | null;
  status: AuthStatus;
  /** Set when the session could not be determined (e.g. API unreachable at startup). */
  bootError: ApiError | null;
  /** Signs in with email/password; throws `ApiError` (`INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`…). */
  login: (body: LoginRequest) => Promise<UserDto>;
  /** Creates an account. When `requiresVerification` is false the user is signed in immediately. */
  register: (body: RegisterRequest) => Promise<RegisterResponse>;
  /** Signs out (revokes the session server-side and clears every cached query). */
  logout: () => Promise<void>;
  /** Re-fetches the current user (`GET /auth/me`). */
  refreshUser: () => Promise<UserDto | null>;
  /** `PATCH /users/me` and updates the cached user. */
  updateMe: (body: UpdateMeRequest) => Promise<UserDto>;
  /** Replaces the cached user (after flows that sign in outside `login`, e.g. email verification). */
  setUser: (user: UserDto | null) => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

function isSignedOutError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 401 || error.code === 'UNAUTHORIZED' || error.code === 'SESSION_EXPIRED')
  );
}

async function fetchCurrentUser(signal?: AbortSignal): Promise<UserDto | null> {
  await ensureCsrfToken();
  try {
    const { user } = await api.auth.me({ signal });
    return user;
  } catch (error) {
    if (isSignedOutError(error)) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: ({ signal }) => fetchCurrentUser(signal),
    staleTime: 5 * 60_000,
    // Keep startup snappy: one quick retry for transient failures, then fall back to signed-out.
    retry: (count, error) => count < 1 && shouldRetryQuery(count, error),
    retryDelay: 600,
    refetchOnWindowFocus: true,
  });

  const setUser = React.useCallback(
    (user: UserDto | null) => queryClient.setQueryData<UserDto | null>(queryKeys.auth.me, user),
    [queryClient],
  );

  /** Drops cached data belonging to the previous session, keeping the auth entry. */
  const resetSessionData = React.useCallback(
    (user: UserDto | null) => {
      queryClient.cancelQueries().catch(() => undefined);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
      queryClient.removeQueries({ queryKey: queryKeys.auth.sessions });
      queryClient.setQueryData<UserDto | null>(queryKeys.auth.me, user);
    },
    [queryClient],
  );

  React.useEffect(() => {
    const offExpired = onSessionExpired(() => resetSessionData(null));
    const offRefreshed = onSessionRefreshed((user) => setUser(user));
    return () => {
      offExpired();
      offRefreshed();
    };
  }, [resetSessionData, setUser]);

  const login = React.useCallback(
    async (body: LoginRequest) => {
      const { user } = await api.auth.login(body);
      resetSessionData(user);
      return user;
    },
    [resetSessionData],
  );

  const register = React.useCallback(
    async (body: RegisterRequest) => {
      const res = await api.auth.register(body);
      if (!res.requiresVerification) resetSessionData(res.user);
      return res;
    },
    [resetSessionData],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // The session is cleared locally even if the server could not be reached.
    } finally {
      resetSessionData(null);
    }
  }, [resetSessionData]);

  const refreshUser = React.useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: queryKeys.auth.me, exact: true });
    return queryClient.getQueryData<UserDto | null>(queryKeys.auth.me) ?? null;
  }, [queryClient]);

  const updateMe = React.useCallback(
    async (body: UpdateMeRequest) => {
      const user = await api.users.updateMe(body);
      setUser(user);
      return user;
    },
    [setUser],
  );

  const user = meQuery.data ?? null;
  const status: AuthStatus = meQuery.isPending ? 'loading' : user ? 'authenticated' : 'anonymous';
  const bootError = !user && meQuery.error instanceof ApiError ? meQuery.error : null;

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, status, bootError, login, register, logout, refreshUser, updateMe, setUser }),
    [user, status, bootError, login, register, logout, refreshUser, updateMe, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Current authentication state and actions. Must be used under `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
