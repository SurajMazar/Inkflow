import { describe, expect, it } from 'vitest';
import { csrfCheck } from './csrf.guard';

const valid = (token: string) => token.endsWith('.sig');

describe('CSRF double-submit check', () => {
  const cookies = { inkflow_at: 'jwt', inkflow_csrf: 'nonce.sig' };

  it('allows safe methods and requests without auth cookies', () => {
    expect(csrfCheck({ method: 'GET', hasBearer: false, cookies, header: undefined }, valid)).toBe(true);
    expect(csrfCheck({ method: 'OPTIONS', hasBearer: false, cookies, header: undefined }, valid)).toBe(true);
    expect(csrfCheck({ method: 'POST', hasBearer: false, cookies: {}, header: undefined }, valid)).toBe(true);
  });

  it('exempts bearer-authenticated requests', () => {
    expect(csrfCheck({ method: 'DELETE', hasBearer: true, cookies, header: undefined }, valid)).toBe(true);
  });

  it('requires the header to match the cookie and carry a valid signature', () => {
    expect(csrfCheck({ method: 'POST', hasBearer: false, cookies, header: 'nonce.sig' }, valid)).toBe(true);
    expect(csrfCheck({ method: 'POST', hasBearer: false, cookies, header: undefined }, valid)).toBe(false);
    expect(csrfCheck({ method: 'PATCH', hasBearer: false, cookies, header: 'other.sig' }, valid)).toBe(false);
    expect(csrfCheck({ method: 'POST', hasBearer: false, cookies: { inkflow_at: 'jwt' }, header: 'nonce.sig' }, valid)).toBe(false);
    const unsigned = { inkflow_rt: 'refresh', inkflow_csrf: 'forged' };
    expect(csrfCheck({ method: 'POST', hasBearer: false, cookies: unsigned, header: 'forged' }, valid)).toBe(false);
  });
});
