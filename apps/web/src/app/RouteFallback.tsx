import { Spinner } from '@inkflow/ui';

/** Suspense fallback for lazily loaded routes inside a layout. */
export function RouteFallback() {
  return (
    <div className="flex min-h-48 items-center justify-center py-16" role="status" aria-live="polite">
      <Spinner className="size-5" label="Loading page" />
    </div>
  );
}
