import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@inkflow/shared';

const NON_RETRYABLE = new Set(['UNAUTHORIZED', 'SESSION_EXPIRED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED']);

/** Retry transient failures (network, 5xx) a couple of times; never retry 4xx. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (NON_RETRYABLE.has(error.code)) return false;
    if (error.status >= 400 && error.status < 500 && error.code !== 'RATE_LIMITED') return false;
  }
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

/** Application-wide query client (also used by imperative helpers such as `invalidateNotifications`). */
export const queryClient = createQueryClient();
