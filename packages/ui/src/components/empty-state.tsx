import * as React from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary / secondary actions (buttons, links). */
  action?: React.ReactNode;
  size?: 'default' | 'sm';
}

export function EmptyState({ icon, title, description, action, size = 'default', className, ...props }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed text-center',
        size === 'default' ? 'gap-3 px-6 py-14' : 'gap-2 px-4 py-8',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden
          className={cn(
            'flex items-center justify-center rounded-xl border bg-background text-muted-foreground shadow-xs',
            size === 'default' ? 'size-11 [&_svg]:size-5' : 'size-9 [&_svg]:size-4',
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className={cn('font-medium', size === 'default' ? 'text-base' : 'text-sm')}>{title}</h3>
        {description ? <p className="text-sm text-balance text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
