import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

export interface SpinnerProps extends React.ComponentProps<'svg'> {
  /** Accessible label announced to screen readers. Pass `null` for decorative spinners. */
  label?: string | null;
}

export function Spinner({ className, label = 'Loading', ...props }: SpinnerProps) {
  return (
    <Loader2
      data-slot="spinner"
      role={label ? 'status' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className={cn('size-4 animate-spin text-muted-foreground', className)}
      {...props}
    />
  );
}
