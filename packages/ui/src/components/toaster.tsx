import * as React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function subscribeToRootClass(callback: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function readRootTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * Sonner toaster styled with the Inkflow tokens. When `theme` is not provided it follows the
 * `.dark` class on `<html>`, so it always matches the application theme.
 */
export function Toaster({ theme, ...props }: ToasterProps) {
  const rootTheme = React.useSyncExternalStore(subscribeToRootClass, readRootTheme, () => 'light' as const);
  return (
    <Sonner
      theme={theme ?? rootTheme}
      className="toaster group"
      position="bottom-right"
      closeButton
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: 'font-sans', description: 'text-muted-foreground' } }}
      {...props}
    />
  );
}

export { toast } from 'sonner';
export type { ToasterProps, ExternalToast } from 'sonner';
