import * as React from 'react';
import type { ThemePreference } from '@inkflow/shared';
import { usePreferences } from '@/features/auth/usePreferences';
import { STORAGE_KEYS, writeJson } from '@/lib/storage';

export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  /** The user's choice. */
  theme: ThemePreference;
  /** What is actually applied (`system` resolved through `prefers-color-scheme`). */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  highContrast: boolean;
  setHighContrast: (enabled: boolean) => void;
  /** True when the user preference OR the OS asks for reduced motion. */
  reduceMotion: boolean;
  /** The user's own reduce-motion preference (ignores the OS setting). */
  reduceMotionPreference: boolean;
  setReduceMotion: (enabled: boolean) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const THEME_COLORS = {
  light: '#ffffff',
  dark: '#131316',
  darkHighContrast: '#000000',
} as const;

function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (callback: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', callback);
      return () => mql.removeEventListener('change', callback);
    },
    [query],
  );
  const getSnapshot = React.useCallback(
    () =>
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
    [query],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Applies the theme to `<html>`: `.dark`, `data-contrast`, `data-reduce-motion`, `color-scheme`, theme-color. */
export function applyThemeToDocument(
  resolved: ResolvedTheme,
  highContrast: boolean,
  reduceMotion: boolean,
): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  if (highContrast) root.setAttribute('data-contrast', 'high');
  else root.removeAttribute('data-contrast');
  if (reduceMotion) root.setAttribute('data-reduce-motion', 'true');
  else root.removeAttribute('data-reduce-motion');
  const color =
    resolved === 'dark'
      ? highContrast
        ? THEME_COLORS.darkHighContrast
        : THEME_COLORS.dark
      : THEME_COLORS.light;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

/**
 * Theme state backed by user preferences (account for signed-in users, localStorage otherwise).
 * Must be rendered inside `<AuthProvider>`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { preferences, updatePreferences } = usePreferences();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const theme = preferences.theme;
  const highContrast = preferences.highContrast;
  const reduceMotionPreference = preferences.reduceMotion;
  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  const reduceMotion = reduceMotionPreference || prefersReducedMotion;

  React.useLayoutEffect(() => {
    applyThemeToDocument(resolvedTheme, highContrast, reduceMotionPreference);
  }, [resolvedTheme, highContrast, reduceMotionPreference]);

  React.useEffect(() => {
    // Cache for `public/theme-init.js`, which applies the theme before the app boots.
    writeJson(STORAGE_KEYS.appearance, {
      theme,
      highContrast,
      reduceMotion: reduceMotionPreference,
    });
  }, [theme, highContrast, reduceMotionPreference]);

  const setTheme = React.useCallback(
    (next: ThemePreference) => void updatePreferences({ theme: next }),
    [updatePreferences],
  );
  const setHighContrast = React.useCallback(
    (enabled: boolean) => void updatePreferences({ highContrast: enabled }),
    [updatePreferences],
  );
  const setReduceMotion = React.useCallback(
    (enabled: boolean) => void updatePreferences({ reduceMotion: enabled }),
    [updatePreferences],
  );

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      highContrast,
      setHighContrast,
      reduceMotion,
      reduceMotionPreference,
      setReduceMotion,
    }),
    [
      theme,
      resolvedTheme,
      setTheme,
      highContrast,
      setHighContrast,
      reduceMotion,
      reduceMotionPreference,
      setReduceMotion,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Current theme and setters. Must be used under `<ThemeProvider>`. */
export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
