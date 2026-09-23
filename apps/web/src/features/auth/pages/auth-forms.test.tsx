import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { __resetClientStateForTests } from '@/lib/api/client';
import { apiError, installFetchMock, type MockRoute } from '@/test/fetch-mock';
import { makeUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { __resetAnonymousPreferencesForTests } from '../preferences-store';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';

const anonymousRoutes: MockRoute[] = [
  { method: 'GET', path: '/auth/csrf', respond: { body: { csrfToken: 'csrf-1' } } },
  { method: 'GET', path: '/auth/me', respond: apiError(401, 'UNAUTHORIZED') },
  { method: 'POST', path: '/auth/refresh', respond: apiError(401, 'SESSION_EXPIRED') },
  { method: 'GET', path: '/auth/providers', respond: { body: { password: true, google: true, github: false } } },
];

beforeEach(() => {
  __resetClientStateForTests();
  __resetAnonymousPreferencesForTests();
});

describe('LoginPage', () => {
  it('validates fields before calling the API', async () => {
    const mock = installFetchMock(anonymousRoutes);
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login' });

    await user.click(await screen.findByTestId('login-submit'));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(screen.getByTestId('login-email')).toHaveAttribute('aria-invalid', 'true');
    expect(mock.callsTo('POST', '/auth/login')).toHaveLength(0);
  });

  it('shows enabled OAuth providers only', async () => {
    installFetchMock(anonymousRoutes);
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login' });
    expect(await screen.findByTestId('oauth-google')).toHaveAttribute('href', '/api/auth/oauth/google');
    expect(screen.queryByTestId('oauth-github')).not.toBeInTheDocument();
  });

  it('signs in and navigates to ?next', async () => {
    const mock = installFetchMock([
      ...anonymousRoutes,
      { method: 'POST', path: '/auth/login', respond: { body: { user: makeUser() } } },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, {
      route: '/login?next=%2Fw%2Fw1',
      path: '/login',
      routes: [{ path: '/w/:workspaceId', element: <div data-testid="workspace-page" /> }],
    });

    await user.type(await screen.findByTestId('login-email'), '  Ada@Example.com ');
    await user.type(screen.getByTestId('login-password'), 'correct horse 1');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('workspace-page')).toBeInTheDocument();
    const [login] = mock.callsTo('POST', '/auth/login');
    expect(login!.body).toEqual({ email: 'ada@example.com', password: 'correct horse 1' });
    expect(login!.headers.get('x-csrf-token')).toBe('csrf-1');
  });

  it('offers to resend the verification email for unverified accounts', async () => {
    const mock = installFetchMock([
      ...anonymousRoutes,
      { method: 'POST', path: '/auth/login', respond: apiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email') },
      { method: 'POST', path: '/auth/resend-verification', respond: { body: { ok: true } } },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login' });

    await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'whatever');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByText('Please verify your email first.')).toBeInTheDocument();
    await user.click(screen.getByTestId('login-resend-verification'));
    await waitFor(() => expect(mock.callsTo('POST', '/auth/resend-verification')).toHaveLength(1));
    expect(mock.callsTo('POST', '/auth/resend-verification')[0]!.body).toEqual({ email: 'ada@example.com' });
  });

  it('shows a clear message for wrong credentials', async () => {
    installFetchMock([
      ...anonymousRoutes,
      { method: 'POST', path: '/auth/login', respond: apiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials') },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />, { route: '/login', path: '/login' });
    await user.type(await screen.findByTestId('login-email'), 'ada@example.com');
    await user.type(screen.getByTestId('login-password'), 'wrong');
    await user.click(screen.getByTestId('login-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });
});

describe('RegisterPage', () => {
  it('validates name, email and password strength with the shared schema', async () => {
    const mock = installFetchMock(anonymousRoutes);
    const user = userEvent.setup();
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' });

    await user.type(await screen.findByTestId('register-email'), 'not-an-email');
    await user.type(screen.getByTestId('register-password'), 'short');
    expect(screen.getByText('Too short')).toBeInTheDocument();
    await user.click(screen.getByTestId('register-submit'));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 10 characters')).toBeInTheDocument();
    expect(mock.callsTo('POST', '/auth/register')).toHaveLength(0);
  });

  it('shows the "check your inbox" state when verification is required', async () => {
    const mock = installFetchMock([
      ...anonymousRoutes,
      {
        method: 'POST',
        path: '/auth/register',
        respond: { body: { user: makeUser({ emailVerified: false }), requiresVerification: true } },
      },
      { method: 'POST', path: '/auth/resend-verification', respond: { body: { ok: true } } },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' });

    await user.type(await screen.findByTestId('register-name'), 'Ada Lovelace');
    await user.type(screen.getByTestId('register-email'), 'ada@example.com');
    await user.type(screen.getByTestId('register-password'), 'analytical-engine-1843');
    expect(screen.getByText('Strong')).toBeInTheDocument();
    await user.click(screen.getByTestId('register-submit'));

    const success = await screen.findByTestId('register-success');
    expect(success).toHaveTextContent('ada@example.com');
    expect(mock.callsTo('POST', '/auth/register')[0]!.body).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'analytical-engine-1843',
    });
    await user.click(screen.getByTestId('register-resend'));
    await waitFor(() => expect(mock.callsTo('POST', '/auth/resend-verification')).toHaveLength(1));
  });

  it('maps a duplicate email to the email field', async () => {
    installFetchMock([
      ...anonymousRoutes,
      { method: 'POST', path: '/auth/register', respond: apiError(409, 'CONFLICT', 'Email already registered') },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<RegisterPage />, { route: '/register', path: '/register' });
    await user.type(await screen.findByTestId('register-name'), 'Ada');
    await user.type(screen.getByTestId('register-email'), 'ada@example.com');
    await user.type(screen.getByTestId('register-password'), 'analytical-engine-1843');
    await user.click(screen.getByTestId('register-submit'));
    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument();
  });
});
