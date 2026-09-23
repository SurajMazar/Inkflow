import * as React from 'react';
import { Avatar as AvatarPrimitive } from 'radix-ui';
import { cn } from '../lib/cn';

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn('relative flex size-8 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  );
}

export function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-[0.7em] font-medium text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export interface UserAvatarProps extends Omit<
  React.ComponentProps<typeof AvatarPrimitive.Root>,
  'children'
> {
  name: string;
  src?: string | null;
  /** Background color of the initials fallback (e.g. a collaborator color). */
  color?: string;
}

/** Avatar with image and initials fallback. The accessible name is the user's name. */
export function UserAvatar({ name, src, color, className, ...props }: UserAvatarProps) {
  return (
    <Avatar className={className} {...props}>
      {src ? <AvatarImage src={src} alt={name} /> : null}
      <AvatarFallback
        aria-label={name}
        role="img"
        style={color ? { backgroundColor: color, color: 'white' } : undefined}
        delayMs={src ? 400 : 0}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}
