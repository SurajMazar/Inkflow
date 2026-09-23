import * as React from 'react';
import { Outlet, createBrowserRouter, type RouteObject } from 'react-router';
import { RedirectIfAuthenticated, RequireAuth, RequireAuthOrShareToken } from '@/features/auth/guards';
import { FullPageLoader } from '@/components/FullPageState';
import { AppProviders } from './AppProviders';
import { NotFoundPage, RouteErrorPage } from './ErrorBoundary';

const lazyPage = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) =>
  React.lazy(async () => ({ default: (await loader())[name] as React.ComponentType }));

// Auth & public pages
const LoginPage = lazyPage(() => import('@/features/auth/pages/LoginPage'), 'LoginPage');
const RegisterPage = lazyPage(() => import('@/features/auth/pages/RegisterPage'), 'RegisterPage');
const VerifyEmailPage = lazyPage(() => import('@/features/auth/pages/VerifyEmailPage'), 'VerifyEmailPage');
const ForgotPasswordPage = lazyPage(() => import('@/features/auth/pages/ForgotPasswordPage'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(() => import('@/features/auth/pages/ResetPasswordPage'), 'ResetPasswordPage');
const OAuthCallbackPage = lazyPage(() => import('@/features/auth/pages/OAuthCallbackPage'), 'OAuthCallbackPage');
const InviteAcceptPage = lazyPage(() => import('@/features/auth/pages/InviteAcceptPage'), 'InviteAcceptPage');
const ShareLinkPage = lazyPage(() => import('@/features/share-link/ShareLinkPage'), 'ShareLinkPage');

// Dashboard
const HomeRedirect = lazyPage(() => import('@/features/dashboard/HomeRedirect'), 'HomeRedirect');
const DashboardLayout = lazyPage(() => import('@/features/dashboard/DashboardLayout'), 'DashboardLayout');
const HomeView = lazyPage(() => import('@/features/dashboard/views/HomeView'), 'HomeView');
const FavoritesView = lazyPage(() => import('@/features/dashboard/views/FavoritesView'), 'FavoritesView');
const SharedView = lazyPage(() => import('@/features/dashboard/views/SharedView'), 'SharedView');
const TemplatesView = lazyPage(() => import('@/features/dashboard/views/TemplatesView'), 'TemplatesView');
const TrashView = lazyPage(() => import('@/features/dashboard/views/TrashView'), 'TrashView');
const ProjectView = lazyPage(() => import('@/features/dashboard/views/ProjectView'), 'ProjectView');
const WorkspaceSettingsPage = lazyPage(() => import('@/features/workspaces/WorkspaceSettingsPage'), 'WorkspaceSettingsPage');
const SettingsPage = lazyPage(() => import('@/features/settings/SettingsPage'), 'SettingsPage');

// Editor (owned by the editor team)
const BoardPage = React.lazy(() => import('@/features/editor/BoardPage'));

function Page({ children }: { children: React.ReactNode }) {
  return <React.Suspense fallback={<FullPageLoader />}>{children}</React.Suspense>;
}

export const routes: RouteObject[] = [
  {
    element: (
      <AppProviders>
        <Outlet />
      </AppProviders>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      {
        errorElement: <RouteErrorPage />,
        children: [
          {
            element: <RedirectIfAuthenticated />,
            children: [
              { path: '/login', element: <Page><LoginPage /></Page> },
              { path: '/register', element: <Page><RegisterPage /></Page> },
            ],
          },
          { path: '/verify-email', element: <Page><VerifyEmailPage /></Page> },
          { path: '/forgot-password', element: <Page><ForgotPasswordPage /></Page> },
          { path: '/reset-password', element: <Page><ResetPasswordPage /></Page> },
          { path: '/auth/callback', element: <Page><OAuthCallbackPage /></Page> },
          { path: '/invite/:token', element: <Page><InviteAcceptPage /></Page> },
          { path: '/s/:token', element: <Page><ShareLinkPage /></Page> },
          {
            path: '/b/:boardId',
            element: (
              <RequireAuthOrShareToken>
                <Page>
                  <BoardPage />
                </Page>
              </RequireAuthOrShareToken>
            ),
          },
          {
            element: <RequireAuth />,
            children: [
              { path: '/', element: <Page><HomeRedirect /></Page> },
              {
                path: '/w/:workspaceId',
                element: <Page><DashboardLayout /></Page>,
                children: [
                  { index: true, element: <HomeView /> },
                  { path: 'favorites', element: <FavoritesView /> },
                  { path: 'shared', element: <SharedView /> },
                  { path: 'templates', element: <TemplatesView /> },
                  { path: 'trash', element: <TrashView /> },
                  { path: 'projects/:projectId', element: <ProjectView /> },
                  { path: 'settings', element: <WorkspaceSettingsPage /> },
                ],
              },
              { path: '/settings/:section?', element: <Page><SettingsPage /></Page> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
