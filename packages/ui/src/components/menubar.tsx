import * as React from 'react';
import { Menubar as MenubarPrimitive } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import {
  menuCheckItemClass,
  menuContentClass,
  menuItemClass,
  menuLabelClass,
  menuSeparatorClass,
  menuShortcutClass,
  menuSubTriggerClass,
} from './menu-styles';

export function MenubarMenu(props: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu {...props} />;
}
export const MenubarGroup = MenubarPrimitive.Group;
export const MenubarSub = MenubarPrimitive.Sub;
export const MenubarRadioGroup = MenubarPrimitive.RadioGroup;

export function Menubar({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Root>) {
  return (
    <MenubarPrimitive.Root
      data-slot="menubar"
      className={cn(
        'flex h-9 items-center gap-1 rounded-md border bg-background p-1 shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        'flex items-center rounded-sm px-2 py-1 text-sm font-medium outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function MenubarContent({
  className,
  align = 'start',
  alignOffset = -4,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Content>) {
  return (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.Content
        data-slot="menubar-content"
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn(
          menuContentClass,
          'min-w-[12rem] origin-(--radix-menubar-content-transform-origin)',
          className,
        )}
        {...props}
      />
    </MenubarPrimitive.Portal>
  );
}

export function MenubarItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Item> & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <MenubarPrimitive.Item
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      className={cn(menuItemClass, className)}
      {...props}
    />
  );
}

export function MenubarCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.CheckboxItem>) {
  return (
    <MenubarPrimitive.CheckboxItem
      className={cn(menuCheckItemClass, className)}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenubarPrimitive.ItemIndicator>
          <Check className="size-4" aria-hidden />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.CheckboxItem>
  );
}

export function MenubarLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Label> & { inset?: boolean }) {
  return (
    <MenubarPrimitive.Label
      data-inset={inset ? '' : undefined}
      className={cn(menuLabelClass, className)}
      {...props}
    />
  );
}

export function MenubarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Separator>) {
  return <MenubarPrimitive.Separator className={cn(menuSeparatorClass, className)} {...props} />;
}

export function MenubarShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn(menuShortcutClass, className)} {...props} />;
}

export function MenubarSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <MenubarPrimitive.SubTrigger
      data-inset={inset ? '' : undefined}
      className={cn(menuSubTriggerClass, className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-4" aria-hidden />
    </MenubarPrimitive.SubTrigger>
  );
}

export function MenubarSubContent({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubContent>) {
  return (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.SubContent
        className={cn(
          menuContentClass,
          'origin-(--radix-menubar-content-transform-origin)',
          className,
        )}
        {...props}
      />
    </MenubarPrimitive.Portal>
  );
}
