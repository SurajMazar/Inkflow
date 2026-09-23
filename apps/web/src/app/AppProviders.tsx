import * as React from 'react';
import { Toaster, TooltipProvider } from '@inkflow/ui';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ThemeProvider, useTheme } from '@/features/theme/ThemeProvider';
import { OfflineBanner } from './OfflineBanner';
import { SkipLink } from './SkipLink';

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme} />;
}

/**
 * Providers that need the router context (rendered by the root route): auth, theme, tooltips,
 * toasts, the skip link and the offline banner. The QueryClientProvider lives above the router.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <TooltipProvider>
          <SkipLink />
          {children}
          <OfflineBanner />
          <ThemedToaster />
        </TooltipProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
