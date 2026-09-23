import * as React from 'react';
import { Link } from 'react-router';
import { Logo } from '@/components/Logo';

export interface AuthLayoutProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Content under the card (e.g. "Don't have an account? Sign up"). */
  footer?: React.ReactNode;
}

/** Minimal, centered layout shared by sign-in, sign-up and account recovery pages. */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-16 items-center px-6">
        <Link to="/" className="rounded-md" aria-label="Inkflow home">
          <Logo />
        </Link>
      </header>
      <main
        id="main-content"
        className="flex flex-1 items-start justify-center px-4 pt-[6vh] pb-16 sm:items-center sm:pt-0"
      >
        <div className="w-full max-w-[400px]">
          <div className="rounded-2xl border bg-card p-6 sm:p-8">
            <div className="mb-6 flex flex-col gap-1.5">
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            {children}
          </div>
          {footer ? (
            <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

/** Inline form-level alert (announced politely). */
export function FormAlert({
  children,
  variant = 'error',
  className,
}: {
  children: React.ReactNode;
  variant?: 'error' | 'info' | 'success';
  className?: string;
}) {
  const styles =
    variant === 'error'
      ? 'border-destructive/30 bg-destructive/5 text-destructive'
      : variant === 'success'
        ? 'border-success/30 bg-success/5 text-foreground'
        : 'border-border bg-muted text-foreground';
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2.5 text-sm ${styles} ${className ?? ''}`}
    >
      {children}
    </div>
  );
}
