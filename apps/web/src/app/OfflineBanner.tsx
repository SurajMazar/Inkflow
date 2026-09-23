import * as React from 'react';
import { WifiOff } from 'lucide-react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** `navigator.onLine` as reactive state. */
export function useOnlineStatus(): boolean {
  return React.useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/** Fixed banner shown while the browser is offline (announced politely). */
export function OfflineBanner() {
  const online = useOnlineStatus();
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
      {!online ? (
        <div
          className="pointer-events-auto flex items-center gap-2 rounded-full border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-md"
          data-testid="offline-banner"
        >
          <WifiOff className="size-4 text-muted-foreground" aria-hidden />
          You're offline. Some actions are unavailable until you reconnect.
        </div>
      ) : null}
    </div>
  );
}
