import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * Styled native `<select>`. Preferred for compact form pickers (roles, expiry) because it is fully
 * accessible, uses the platform picker on touch devices and is trivial to automate in tests.
 */
export function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: React.ComponentProps<'select'> & { wrapperClassName?: string }) {
  return (
    <div className={cn('relative inline-flex', wrapperClassName)} data-slot="native-select">
      <select
        className={cn(
          'h-9 w-full appearance-none rounded-md border border-input bg-background py-1 pr-8 pl-3 text-sm shadow-xs outline-none transition-[color,box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/10 pointer-coarse:h-10 [&>option]:bg-popover [&>option]:text-popover-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
