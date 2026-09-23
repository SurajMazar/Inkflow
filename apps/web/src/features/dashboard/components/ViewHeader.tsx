import * as React from 'react';
import { cn } from '@inkflow/ui';

export function ViewHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0">
        {breadcrumbs}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Standard padded container for dashboard views. */
export function ViewContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 sm:px-8 sm:py-8', className)}>{children}</div>;
}
