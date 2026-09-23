import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@inkflow/ui';
import { AlertTriangle, Check, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { useBoardSession } from '../hooks/editor-context';

const LABELS = {
  saved: 'Saved',
  saving: 'Saving…',
  syncing: 'Syncing…',
  offline: 'Offline',
  error: 'Save error',
} as const;

/** Autosave / connection indicator (Saving… · Saved · Offline · Syncing…). */
export function SyncStatusBadge() {
  const { sync, canEdit } = useBoardSession();
  const state = sync.save;
  const Icon =
    state === 'saved'
      ? Check
      : state === 'offline'
        ? CloudOff
        : state === 'error'
          ? AlertTriangle
          : state === 'syncing'
            ? RefreshCw
            : Loader2;
  const detail =
    state === 'offline'
      ? sync.pendingOps > 0
        ? `${sync.pendingOps} change${sync.pendingOps === 1 ? '' : 's'} stored on this device; they will sync when you reconnect.`
        : 'You are offline. Changes will be stored on this device.'
      : state === 'syncing'
        ? `Uploading ${sync.pendingOps} change${sync.pendingOps === 1 ? '' : 's'} made while offline.`
        : state === 'error'
          ? (sync.error ?? 'Some changes could not be saved.')
          : state === 'saving'
            ? 'Saving your latest changes…'
            : sync.lastSavedAt
              ? `All changes saved at ${new Date(sync.lastSavedAt).toLocaleTimeString()}`
              : 'All changes saved';
  if (!canEdit && state === 'saved') {
    return (
      <span
        className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
        data-testid="save-status"
      >
        View only
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-live="polite"
          data-testid="save-status"
          data-state={state}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground',
            state === 'offline' &&
              'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
            state === 'error' && 'bg-destructive/10 text-destructive',
          )}
        >
          <Icon
            className={cn('size-3', (state === 'saving' || state === 'syncing') && 'animate-spin')}
            aria-hidden="true"
          />
          {LABELS[state]}
        </span>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}
