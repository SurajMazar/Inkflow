import * as React from 'react';
import { Button, Spinner } from '@inkflow/ui';
import { WifiOff } from 'lucide-react';
import { LogoMark } from './Logo';

/** Centered loading indicator for route transitions and session bootstrap. */
export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <Spinner className="size-5" label={null} />
        <span>{label}</span>
      </div>
    </div>
  );
}

export interface FullPageMessageProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/** Centered message page used for errors, 404s and one-off flows. */
export function FullPageMessage({ icon, title, description, actions }: FullPageMessageProps) {
  return (
    <main id="main-content" className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        {icon ?? <LogoMark className="size-10" />}
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
          {description ? <div className="text-sm text-balance text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
      </div>
    </main>
  );
}

export function ConnectionErrorPage({ onRetry }: { onRetry: () => void }) {
  return (
    <FullPageMessage
      icon={
        <div className="flex size-11 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
          <WifiOff className="size-5" aria-hidden />
        </div>
      }
      title="Can't reach Inkflow"
      description="We couldn't connect to the server. Check your connection — we'll pick up where you left off."
      actions={<Button onClick={onRetry}>Try again</Button>}
    />
  );
}
