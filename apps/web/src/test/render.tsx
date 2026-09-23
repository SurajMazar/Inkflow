import * as React from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, type Location } from 'react-router';
import { Toaster, TooltipProvider } from '@inkflow/ui';
import { createQueryClient } from '@/lib/query-client';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ThemeProvider } from '@/features/theme/ThemeProvider';

export interface RenderOptions {
  /** Initial URL. */
  route?: string;
  /** Route path pattern for `ui` (e.g. `/w/:workspaceId`). */
  path?: string;
  /** Extra routes (e.g. navigation targets): `{ path, element }`. */
  routes?: { path: string; element: React.ReactElement }[];
  /** Nested child routes of `ui` (for layouts rendering an `<Outlet />`). */
  children?: { path?: string; index?: boolean; element: React.ReactElement }[];
  queryClient?: QueryClient;
}

export function testQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false, gcTime: Infinity },
    mutations: { retry: false },
  });
  return client;
}

/** Test location probe (the current router location is exposed on `location.current`). */
function LocationProbe({ target }: { target: { current: Location | null } }) {
  target.current = useLocation();
  return null;
}

/**
 * Renders `ui` inside the real app providers and a memory router (declarative mode — jsdom's
 * AbortSignal is incompatible with the data router's `Request` objects).
 */
export function renderWithProviders(ui: React.ReactElement, options: RenderOptions = {}) {
  const queryClient = options.queryClient ?? testQueryClient();
  const location: { current: Location | null } = { current: null };
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>
        <AuthProvider>
          <ThemeProvider>
            <TooltipProvider>
              <LocationProbe target={location} />
              <Routes>
                <Route path={options.path ?? '/'} element={ui}>
                  {(options.children ?? []).map((child) =>
                    child.index ? (
                      <Route key="index" index element={child.element} />
                    ) : (
                      <Route key={child.path} path={child.path} element={child.element} />
                    ),
                  )}
                </Route>
                {(options.routes ?? []).map((r) => (
                  <Route key={r.path} path={r.path} element={r.element} />
                ))}
                <Route path="*" element={<div data-testid="unmatched-route" />} />
              </Routes>
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, location };
}
