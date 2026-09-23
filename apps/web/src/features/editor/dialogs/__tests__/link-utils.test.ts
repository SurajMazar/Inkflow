import { describe, expect, it } from 'vitest';
import { validateLink } from '../link-utils';

describe('validateLink', () => {
  it.each([
    ['https://example.com/docs?a=1#top', 'https://example.com/docs?a=1#top'],
    ['http://example.com', 'http://example.com/'],
    ['example.com/path', 'https://example.com/path'],
    ['www.example.org', 'https://www.example.org/'],
    ['localhost:3000/x', 'https://localhost:3000/x'],
    ['mailto:team@example.com', 'mailto:team@example.com'],
    ['  https://example.com  ', 'https://example.com/'],
  ])('accepts %s', (input, href) => {
    expect(validateLink(input)).toEqual({ ok: true, href, internal: false });
  });

  it('accepts internal board links', () => {
    expect(validateLink('/b/abc123')).toEqual({ ok: true, href: '/b/abc123', internal: true });
    expect(validateLink('/b/abc_123?frame=2#x')).toEqual({ ok: true, href: '/b/abc_123?frame=2#x', internal: true });
    expect(validateLink(`${window.location.origin}/b/xyz`)).toEqual({ ok: true, href: '/b/xyz', internal: true });
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(document.cookie)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com',
    'javascript:1',
    '/settings',
    '//evil.com/b/x',
    'mailto:',
    'https://user:pass@example.com',
    'not a url',
    '',
  ])('rejects %j', (input) => {
    expect(validateLink(input).ok).toBe(false);
  });
});
