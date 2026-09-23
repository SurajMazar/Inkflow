import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { __resetClientStateForTests } from '@/lib/api/client';
import { getShareToken, setShareToken } from '@/lib/share-token';
import { apiError, installFetchMock, type MockRoute } from '@/test/fetch-mock';
import { makeUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { ShareLinkPage } from '@/features/share-link/ShareLinkPage';
import { RequireAuth, RequireAuthOrShareToken } from './guards';
import { sanitizeNext } from './next-param';

const anonymous: MockRoute[] = [
  { method: 'GET', path: '/auth/csrf', respond: { body: { csrfToken: 'c' } } },
  { method: 'GET', path: '/auth/me', respond: apiError(401, 'UNAUTHORIZED') },
  { method: 'POST', path: '/auth/refresh', respond: apiError(401, 'SESSION_EXPIRED') },
];

const Login = () => <div data-testid="login-page" />;

beforeEach(() => __resetClientStateForTests());

describe('route guards', () => {
  it('RequireAuth redirects anonymous visitors to /login?next=', async () => {
    installFetchMock(anonymous);
    const { location } = renderWithProviders(
      <RequireAuth>
        <div data-testid="private" />
      </RequireAuth>,
      {
        route: '/w/w1/trash?x=1',
        path: '/w/:workspaceId/trash',
        routes: [{ path: '/login', element: <Login /> }],
      },
    );
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(location.current?.search).toBe(`?next=${encodeURIComponent('/w/w1/trash?x=1')}`);
    expect(screen.queryByTestId('private')).not.toBeInTheDocument();
  });

  it('RequireAuth renders children for signed-in users', async () => {
    installFetchMock([
      { method: 'GET', path: '/auth/me', respond: { body: { user: makeUser() } } },
    ]);
    renderWithProviders(
      <RequireAuth>
        <div data-testid="private" />
      </RequireAuth>,
    );
    expect(await screen.findByTestId('private')).toBeInTheDocument();
  });

  it('RequireAuthOrShareToken lets anonymous visitors with a share token through', async () => {
    installFetchMock(anonymous);
    setShareToken('b1', 'tok');
    renderWithProviders(
      <RequireAuthOrShareToken>
        <div data-testid="editor" />
      </RequireAuthOrShareToken>,
      { route: '/b/b1', path: '/b/:boardId', routes: [{ path: '/login', element: <Login /> }] },
    );
    expect(await screen.findByTestId('editor')).toBeInTheDocument();
  });

  it('RequireAuthOrShareToken sends anonymous visitors without a token to sign in', async () => {
    installFetchMock(anonymous);
    renderWithProviders(
      <RequireAuthOrShareToken>
        <div data-testid="editor" />
      </RequireAuthOrShareToken>,
      { route: '/b/b2', path: '/b/:boardId', routes: [{ path: '/login', element: <Login /> }] },
    );
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
  });

  it('sanitizes post-login redirects', () => {
    expect(sanitizeNext('/w/w1')).toBe('/w/w1');
    expect(sanitizeNext('%2Fb%2Fx')).toBe('/b/x');
    expect(sanitizeNext('https://evil.example')).toBe('/');
    expect(sanitizeNext('//evil.example')).toBe('/');
    expect(sanitizeNext('/login?next=/x')).toBe('/');
    expect(sanitizeNext(null)).toBe('/');
  });
});

describe('ShareLinkPage', () => {
  it('stores the share token and opens the board', async () => {
    installFetchMock([
      ...anonymous,
      {
        method: 'GET',
        path: '/share-links/tok-1',
        respond: { body: { boardId: 'b7', boardTitle: 'Plan', role: 'VIEWER', expiresAt: null } },
      },
    ]);
    const { location } = renderWithProviders(<ShareLinkPage />, {
      route: '/s/tok-1',
      path: '/s/:token',
      routes: [{ path: '/b/:boardId', element: <div data-testid="board" /> }],
    });
    expect(await screen.findByTestId('board')).toBeInTheDocument();
    expect(location.current?.pathname).toBe('/b/b7');
    expect(getShareToken('b7')).toBe('tok-1');
  });

  it('explains expired or revoked links', async () => {
    installFetchMock([
      ...anonymous,
      { method: 'GET', path: '/share-links/gone', respond: apiError(404, 'NOT_FOUND') },
    ]);
    renderWithProviders(<ShareLinkPage />, { route: '/s/gone', path: '/s/:token' });
    expect(await screen.findByText('This link has expired or was revoked')).toBeInTheDocument();
    expect(getShareToken('b7')).toBeNull();
  });
});
