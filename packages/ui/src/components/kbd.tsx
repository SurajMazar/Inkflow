import * as React from 'react';
import { cn } from '../lib/cn';

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded border bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground select-none',
        className,
      )}
      {...props}
    />
  );
}

export function KbdGroup({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  );
}
