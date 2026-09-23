import { cn } from '@inkflow/ui';

/** Inkflow mark (pen nib + ink stroke). Decorative unless `title` is provided. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('size-7 shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="64" height="64" rx="15" className="fill-primary" />
      <path
        d="M12 50c5.5-1.2 8.6-4.6 13.4-4.6 5.2 0 6.3 3.8 11.3 3.8 4.3 0 6.6-2.4 9.3-4.7"
        fill="none"
        className="stroke-primary-foreground/55"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <g transform="rotate(42 34 30)">
        <path
          d="M34 50 L24.5 30.5 C24.5 22 28.5 16.5 34 11 C39.5 16.5 43.5 22 43.5 30.5 Z"
          className="fill-primary-foreground"
        />
        <path d="M34 50 V33.5" className="stroke-primary" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="34" cy="30" r="3.2" className="fill-primary" />
      </g>
    </svg>
  );
}

/** Mark + hand-drawn wordmark. */
export function Logo({
  className,
  size = 'default',
}: {
  className?: string;
  size?: 'default' | 'lg';
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className={size === 'lg' ? 'size-9' : 'size-7'} />
      <span
        className={cn('font-hand font-bold tracking-tight', size === 'lg' ? 'text-2xl' : 'text-xl')}
      >
        Inkflow
      </span>
    </span>
  );
}
