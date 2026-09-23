import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { cn } from '../lib/cn';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';

export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground',
        className,
      )}
      {...props}
    />
  );
}

export interface CommandDialogProps extends React.ComponentProps<typeof Dialog> {
  title?: string;
  description?: string;
  className?: string;
  /** Props forwarded to the inner `<Command>` (e.g. `shouldFilter={false}` for server results). */
  commandProps?: React.ComponentProps<typeof CommandPrimitive>;
}

export function CommandDialog({
  title = 'Command palette',
  description = 'Search for a command to run…',
  children,
  className,
  commandProps,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn('top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-xl', className)}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command
          {...commandProps}
          className={cn(
            '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-1.5 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0',
            commandProps?.className,
          )}
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({
  className,
  trailing,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & { trailing?: React.ReactNode }) {
  return (
    <div data-slot="command-input-wrapper" className="flex h-12 items-center gap-2 border-b px-3">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:text-base',
          className,
        )}
        {...props}
      />
      {trailing}
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'max-h-[min(60dvh,420px)] scroll-py-1 overflow-x-hidden overflow-y-auto py-1.5',
        className,
      )}
      {...props}
    />
  );
}

export function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('py-8 text-center text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export function CommandLoading(props: React.ComponentProps<typeof CommandPrimitive.Loading>) {
  return <CommandPrimitive.Loading {...props} />;
}

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn('overflow-hidden text-foreground', className)}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground pointer-coarse:min-h-10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
      {...props}
    />
  );
}
