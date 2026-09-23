import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '../lib/cn';

export function TooltipProvider({
  delayDuration = 300,
  skipDelayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  );
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-2 py-1 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export interface SimpleTooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>['side'];
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>['align'];
  /** Render nothing but the trigger when disabled. */
  disabled?: boolean;
}

/** Convenience wrapper: `<SimpleTooltip content="Rename"><Button …/></SimpleTooltip>`. */
export function SimpleTooltip({
  content,
  children,
  side = 'top',
  align,
  disabled,
}: SimpleTooltipProps) {
  if (disabled || content == null || content === '') return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
