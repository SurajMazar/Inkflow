import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { __resetClientStateForTests } from '@/lib/api/client';
import { apiError, installFetchMock, type MockRoute } from '@/test/fetch-mock';
import { makeUser } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { __resetAnonymousPreferencesForTests } from '@/features/auth/preferences-store';
import { useTheme } from './ThemeProvider';

function ThemeControls() {
  const { theme, resolvedTheme, setTheme, highContrast, setHighContrast, setReduceMotion } = useTheme();
  return (
    <div>
      <p data-testid="state">{`${theme}/${resolvedTheme}/${highContrast ? 'hc' : 'normal'}`}</p>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('system')}>system</button>
      <button onClick={() => setHighContrast(!highContrast)}>contrast</button>
      <button onClick={() => setReduceMotion(true)}>motion</button>
    </div>
  );
}

const anonymous: MockRoute[] = [
  { method: 'GET', path: '/auth/csrf', respond: { body: { csrfToken: 'c' } } },
  { method: 'GET', path: '/auth/me', respond: apiError(401, 'UNAUTHORIZED') },
  { method: 'POST', path: '/auth/refresh', respond: apiError(401, 'SESSION_EXPIRED') },
];

let darkQueryMatches = false;
const mediaListeners = new Set<() => void>();

beforeEach(() => {
  __resetClientStateForTests();
  __resetAnonymousPreferencesForTests();
  darkQueryMatches = false;
  mediaListeners.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') ? darkQueryMatches : false,
    media: query,
    addEventListener: (_: string, cb: () => void) => mediaListeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => mediaListeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
});

describe('ThemeProvider', () => {
  it('toggles the .dark class, color-scheme and theme-color, persisting locally when signed out', async () => {
    installFetchMock(anonymous);
    const user = userEvent.setup();
    renderWithProviders(<ThemeControls />);
    const root = document.documentElement;
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('system/light/normal'));
    expect(root).not.toHaveClass('dark');

    await user.click(screen.getByText('dark'));
    expect(root).toHaveClass('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#131316');
    expect(JSON.parse(window.localStorage.getItem('inkflow:preferences')!).theme).toBe('dark');
    expect(JSON.parse(window.localStorage.getItem('inkflow:appearance')!)).toMatchObject({ theme: 'dark' });

    await user.click(screen.getByText('light'));
    expect(root).not.toHaveClass('dark');
    expect(root.style.colorScheme).toBe('light');
  });

  it('follows the OS in system mode', async () => {
    installFetchMock(anonymous);
    darkQueryMatches = true;
    renderWithProviders(<ThemeControls />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('system/dark/normal'));
    expect(document.documentElement).toHaveClass('dark');

    darkQueryMatches = false;
    act(() => mediaListeners.forEach((cb) => cb()));
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
  });

  it('applies high contrast and reduced motion attributes', async () => {
    installFetchMock(anonymous);
    const user = userEvent.setup();
    renderWithProviders(<ThemeControls />);
    await user.click(await screen.findByText('contrast'));
    expect(document.documentElement).toHaveAttribute('data-contrast', 'high');
    await user.click(screen.getByText('motion'));
    expect(document.documentElement).toHaveAttribute('data-reduce-motion', 'true');
    await user.click(screen.getByText('contrast'));
    expect(document.documentElement).not.toHaveAttribute('data-contrast');
  });

  it('saves to the account for signed-in users (PATCH /users/me)', async () => {
    document.cookie = 'inkflow_csrf=c; path=/';
    const me = makeUser();
    const mock = installFetchMock([
      { method: 'GET', path: '/auth/me', respond: { body: { user: me } } },
      {
        method: 'PATCH',
        path: '/users/me',
        respond: (call) => ({
          body: { ...me, preferences: { ...me.preferences, ...(call.body as { preferences: object }).preferences } },
        }),
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ThemeControls />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('system/light/normal'));
    await user.click(screen.getByText('dark'));
    expect(document.documentElement).toHaveClass('dark');
    await waitFor(() => expect(mock.callsTo('PATCH', '/users/me')).toHaveLength(1));
    expect(mock.callsTo('PATCH', '/users/me')[0]!.body).toEqual({ preferences: { theme: 'dark' } });
    expect(window.localStorage.getItem('inkflow:preferences')).toBeNull();
  });

  it('rolls back an optimistic change when saving fails', async () => {
    document.cookie = 'inkflow_csrf=c; path=/';
    installFetchMock([
      { method: 'GET', path: '/auth/me', respond: { body: { user: makeUser() } } },
      { method: 'PATCH', path: '/users/me', respond: apiError(500, 'INTERNAL') },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ThemeControls />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('system/light/normal'));
    await user.click(screen.getByText('dark'));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('system/light/normal'));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(await screen.findByText('Something went wrong on our side')).toBeInTheDocument();
  });
});
