import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationListDto } from '@inkflow/shared';
import { api } from '@/lib/api';
import { queryClient as appQueryClient } from '@/lib/query-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/features/auth/AuthProvider';
import { toastApiError } from './notify';

export const NOTIFICATIONS_POLL_MS = 30_000;
const LIMIT = 30;

/** Re-fetches notifications (e.g. after a socket event). */
export function invalidateNotifications(): Promise<void> {
  return appQueryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
}

/** Notifications for the signed-in user; polls every 30 s and on window focus. */
export function useNotifications() {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.notifications.list,
    queryFn: ({ signal }) => api.notifications.list({ limit: LIMIT }, { signal }),
    enabled: status === 'authenticated',
    refetchInterval: NOTIFICATIONS_POLL_MS,
    refetchOnWindowFocus: 'always',
    staleTime: 10_000,
  });

  const setData = (updater: (data: NotificationListDto) => NotificationListDto) =>
    queryClient.setQueryData<NotificationListDto>(queryKeys.notifications.list, (data) => (data ? updater(data) : data));

  const markRead = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onMutate: (id) => {
      const now = new Date().toISOString();
      setData((data) => {
        const target = data.items.find((n) => n.id === id);
        if (!target || target.readAt) return data;
        return {
          unreadCount: Math.max(0, data.unreadCount - 1),
          items: data.items.map((n) => (n.id === id ? { ...n, readAt: now } : n)),
        };
      });
    },
    onError: (error) => {
      toastApiError(error, "Couldn't update notification");
      void invalidateNotifications();
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onMutate: () => {
      const now = new Date().toISOString();
      setData((data) => ({ unreadCount: 0, items: data.items.map((n) => (n.readAt ? n : { ...n, readAt: now })) }));
    },
    onError: (error) => {
      toastApiError(error, "Couldn't mark notifications as read");
      void invalidateNotifications();
    },
  });

  return {
    notifications: query.data?.items ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    markRead: markRead.mutate,
    markAllRead: markAllRead.mutate,
  };
}
