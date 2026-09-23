import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { queryClient } from '@/lib/query-client';
import { AppErrorBoundary } from './ErrorBoundary';
import { createAppRouter } from './router';

export function App() {
  const [router] = React.useState(createAppRouter);
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
