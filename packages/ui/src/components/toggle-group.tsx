import * as React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { toggleVariants } from './toggle';

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
  size: 'default',
  variant: 'default',
});

export function ToggleGroup({
  className,
  variant,
  size,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof toggleVariants>) {
  const ctx = React.useMemo(() => ({ variant, size }), [variant, size]);
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      className={cn(
        'group/toggle-group flex w-fit items-center gap-0.5 rounded-md',
        variant === 'outline' && 'gap-0 shadow-xs',
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={ctx}>{children}</ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

export function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);
  const resolvedVariant = context.variant ?? variant;
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        toggleVariants({ variant: resolvedVariant, size: context.size ?? size }),
        'shrink-0 focus:z-10 focus-visible:z-10',
        resolvedVariant === 'outline' &&
          'rounded-none shadow-none first:rounded-l-md last:rounded-r-md [&:not(:first-child)]:border-l-0',
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}
