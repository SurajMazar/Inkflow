/**
 * Validates a post-login redirect target. Only same-origin absolute paths are allowed, which
 * prevents open redirects such as `?next=https://evil.example` or `?next=//evil.example`.
 */
export function sanitizeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  let value = next.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/^\/(login|register|auth\/callback)(\/|\?|$)/.test(value)) return fallback;
  return value;
}

/** Builds `/login?next=…` (or another auth route) for the given return path. */
export function authRedirect(
  path: '/login' | '/register',
  next: string | null | undefined,
): string {
  const safe = sanitizeNext(next, '');
  return safe && safe !== '/' ? `${path}?next=${encodeURIComponent(safe)}` : path;
}
