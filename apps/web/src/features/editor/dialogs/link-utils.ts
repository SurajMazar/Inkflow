export type LinkValidation =
  { ok: true; href: string; internal: boolean } | { ok: false; error: string };

const INTERNAL_BOARD_LINK = /^\/b\/[A-Za-z0-9_-]{1,64}(?:[/?#][^\s]*)?$/;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const MAX_LINK_LENGTH = 2048;

/**
 * Validates an element link. Accepts http(s) and mailto URLs and internal board links
 * (`/b/<id>…`). Bare domains get `https://`. Every other scheme (`javascript:`, `data:`,
 * `vbscript:`, `file:` …) is rejected.
 */
export function validateLink(raw: string): LinkValidation {
  const value = raw.trim();
  if (!value) return { ok: false, error: 'Enter a link.' };
  if (value.length > MAX_LINK_LENGTH) return { ok: false, error: 'This link is too long.' };
  // Control characters and whitespace can hide a dangerous scheme (e.g. "java\tscript:").
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(value))
    return { ok: false, error: 'Links cannot contain spaces or control characters.' };

  if (value.startsWith('/')) {
    if (INTERNAL_BOARD_LINK.test(value)) return { ok: true, href: value, internal: true };
    return { ok: false, error: 'Internal links must point to a board, like /b/abc123.' };
  }

  const scheme = SCHEME.exec(value);
  // "example.com:8080/path" parses as scheme "example.com"; treat things that look like hosts as web links.
  const looksLikeHost = !!scheme && /^\d/.test(value.slice(scheme[0].length));
  const candidate = scheme && !looksLikeHost ? value : `https://${value.replace(/^\/\//, '')}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'This doesn’t look like a valid link.' };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, error: 'Only web (http, https) and email (mailto) links are allowed.' };
  }
  if (url.protocol === 'mailto:') {
    if (!/^[^@\s]+@[^@\s]+$/.test(decodeURIComponent(url.pathname)))
      return { ok: false, error: 'Enter a valid email address after mailto:.' };
    return { ok: true, href: url.href, internal: false };
  }
  if (!url.hostname || !(url.hostname.includes('.') || url.hostname === 'localhost')) {
    return { ok: false, error: 'This doesn’t look like a valid web address.' };
  }
  if (url.username || url.password)
    return { ok: false, error: 'Links with embedded credentials are not allowed.' };
  // Links to this app's boards open in the same tab.
  if (
    typeof window !== 'undefined' &&
    url.origin === window.location.origin &&
    INTERNAL_BOARD_LINK.test(url.pathname + url.search + url.hash)
  ) {
    return { ok: true, href: url.pathname + url.search + url.hash, internal: true };
  }
  return { ok: true, href: url.href, internal: false };
}

/** Opens a validated link: internal board links via the router, others in a new tab without opener. */
export function openLink(href: string, navigate: (path: string) => void): void {
  const res = validateLink(href);
  if (!res.ok) return;
  if (res.internal) navigate(res.href);
  else window.open(res.href, '_blank', 'noopener,noreferrer');
}
