import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { UserDto, UserPreferences } from '@inkflow/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { toastApiError } from '@/features/notifications/notify';
import { useAuth } from './AuthProvider';
import {
  applyPreferencesPatch,
  getAnonymousPreferences,
  normalizePreferences,
  setAnonymousPreferences,
  subscribeAnonymousPreferences,
  type PreferencesPatch,
} from './preferences-store';

export type { PreferencesPatch } from './preferences-store';

export interface PreferencesApi {
  /** Effective preferences (defaults filled in). */
  preferences: UserPreferences;
  /**
   * Optimistically applies a patch. Signed-in users: `PATCH /users/me { preferences }`
   * (rolled back with an error toast on failure). Signed-out visitors: saved to localStorage.
   * Resolves `true` when saved, `false` when the save failed (never rejects).
   */
  updatePreferences: (patch: PreferencesPatch, options?: { silent?: boolean }) => Promise<boolean>;
  /** True while a server save is in flight. */
  isSaving: boolean;
  /** Where the preferences are persisted. */
  source: 'account' | 'local';
}

let mutationSeq = 0;

/** User preferences with `DEFAULT_USER_PREFERENCES` fallback and optimistic updates. */
export function usePreferences(): PreferencesApi {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState(0);
  const anonymous = React.useSyncExternalStore(
    subscribeAnonymousPreferences,
    getAnonymousPreferences,
    getAnonymousPreferences,
  );
  const accountPrefs = React.useMemo(() => (user ? normalizePreferences(user.preferences) : null), [user]);
  const preferences = accountPrefs ?? anonymous;

  const updatePreferences = React.useCallback(
    async (patch: PreferencesPatch, options?: { silent?: boolean }) => {
      const cached = queryClient.getQueryData<UserDto | null>(queryKeys.auth.me);
      if (!cached) {
        const { next } = applyPreferencesPatch(getAnonymousPreferences(), patch);
        setAnonymousPreferences(next);
        return true;
      }
      const current = normalizePreferences(cached.preferences);
      const { next, body } = applyPreferencesPatch(current, patch);
      if (Object.keys(body).length === 0) return true;
      const seq = ++mutationSeq;
      queryClient.setQueryData<UserDto | null>(queryKeys.auth.me, (u) => (u ? { ...u, preferences: next } : u));
      setPending((n) => n + 1);
      try {
        const updated = await api.users.updateMe({ preferences: body });
        if (seq === mutationSeq) queryClient.setQueryData<UserDto | null>(queryKeys.auth.me, updated);
        return true;
      } catch (error) {
        if (seq === mutationSeq) {
          queryClient.setQueryData<UserDto | null>(queryKeys.auth.me, (u) =>
            u ? { ...u, preferences: current } : u,
          );
        }
        if (!options?.silent) toastApiError(error, "Couldn't save your preferences");
        return false;
      } finally {
        setPending((n) => n - 1);
      }
    },
    [queryClient],
  );

  return { preferences, updatePreferences, isSaving: pending > 0, source: user ? 'account' : 'local' };
}
