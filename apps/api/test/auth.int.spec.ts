import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthResponse, RegisterResponse, SessionDto } from '@inkflow/shared';
import { SessionsService } from '../src/auth/sessions.service';
import {
  PASSWORD,
  signUp,
  startApp,
  TestClient,
  tokenFromText,
  uniqueEmail,
  waitForEmail,
  type TestApp,
} from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});

describe('auth', () => {
  it('registers, verifies, signs in, rotates refresh tokens and signs out', async () => {
    const email = uniqueEmail('auth');
    const client = new TestClient(t.url);

    const csrf = await client.get<{ csrfToken: string }>('/api/auth/csrf');
    expect(csrf.status).toBe(200);
    expect(client.cookie('inkflow_csrf')).toBe(csrf.body.csrfToken);

    const reg = await client.post<RegisterResponse>('/api/auth/register', { email, password: PASSWORD, name: 'Ada Lovelace' });
    expect(reg.status).toBe(201);
    expect(reg.body.requiresVerification).toBe(true);
    expect(reg.body.user).toMatchObject({ email, name: 'Ada Lovelace', emailVerified: false, hasPassword: true });
    expect(client.cookie('inkflow_at')).toBeUndefined();

    const dup = await client.post('/api/auth/register', { email, password: PASSWORD, name: 'Other' });
    expect(dup.status).toBe(409);
    expect((dup.body as { error: { code: string } }).error.code).toBe('CONFLICT');

    const unverified = await client.post('/api/auth/login', { email, password: PASSWORD });
    expect(unverified.status).toBe(403);
    expect((unverified.body as { error: { code: string } }).error.code).toBe('EMAIL_NOT_VERIFIED');

    const mail = await waitForEmail(email, 'Verify your email');
    const token = tokenFromText(mail.text);
    const verified = await client.post<AuthResponse>('/api/auth/verify-email', { token });
    expect(verified.status).toBe(200);
    expect(verified.body.user.emailVerified).toBe(true);
    expect(client.cookie('inkflow_at')).toBeTruthy();
    expect(client.cookie('inkflow_rt')).toBeTruthy();

    // Verification links are single use.
    const again = await client.post('/api/auth/verify-email', { token });
    expect(again.status).toBe(400);
    expect((again.body as { error: { code: string } }).error.code).toBe('TOKEN_INVALID');

    const me = await client.get<AuthResponse>('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);

    // Fresh login.
    const other = new TestClient(t.url);
    const bad = await other.post('/api/auth/login', { email, password: 'wrong-password-1' });
    expect(bad.status).toBe(401);
    expect((bad.body as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await other.post('/api/auth/login', { email: uniqueEmail('nobody'), password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect((unknown.body as { error: { message: string } }).error.message).toBe((bad.body as { error: { message: string } }).error.message);
    const login = await other.post<AuthResponse>('/api/auth/login', { email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(me.body.user.id);

    // Refresh rotates the refresh token.
    const rt1 = other.cookie('inkflow_rt')!;
    const refreshed = await other.post<AuthResponse>('/api/auth/refresh');
    expect(refreshed.status).toBe(200);
    const rt2 = other.cookie('inkflow_rt')!;
    expect(rt2).not.toBe(rt1);
    expect((await other.get('/api/auth/me')).status).toBe(200);

    const sessions = await other.get<SessionDto[]>('/api/auth/sessions');
    expect(sessions.status).toBe(200);
    expect(sessions.body.length).toBe(2);
    expect(sessions.body.filter((s) => s.current)).toHaveLength(1);

    // Reusing the rotated token revokes the whole family.
    t.app.get(SessionsService).rotationGraceMs = 0;
    const thief = new TestClient(t.url);
    thief.cookies.set('inkflow_rt', { value: rt1, path: '/api/auth' });
    thief.cookies.set('inkflow_csrf', { value: other.cookie('inkflow_csrf')!, path: '/' });
    const reuse = await thief.post('/api/auth/refresh');
    expect(reuse.status).toBe(401);
    expect((reuse.body as { error: { code: string } }).error.code).toBe('SESSION_EXPIRED');
    const afterReuse = await other.post('/api/auth/refresh');
    expect(afterReuse.status).toBe(401);
    // The access token of the revoked family stops working immediately.
    const meAfter = await other.get('/api/auth/me');
    expect(meAfter.status).toBe(401);

    // Logout of the first session.
    const logout = await client.post('/api/auth/logout');
    expect(logout.status).toBe(200);
    expect(client.cookie('inkflow_at')).toBeUndefined();
    expect(client.cookie('inkflow_rt')).toBeUndefined();
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects unsafe cookie-authenticated requests without a matching CSRF token', async () => {
    const client = await signUp(t.url, 'Csrf Tester');
    const missing = await client.patch('/api/users/me', { name: 'X' }, { csrf: false });
    expect(missing.status).toBe(403);
    expect((missing.body as { error: { code: string } }).error.code).toBe('CSRF_INVALID');
    const wrong = await client.patch('/api/users/me', { name: 'X' }, { csrf: false, headers: { 'x-csrf-token': 'forged.token' } });
    expect(wrong.status).toBe(403);
    const ok = await client.patch<{ name: string }>('/api/users/me', { name: 'Csrf Passed' });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('Csrf Passed');
    // Bearer-authenticated requests are exempt.
    const bearer = new TestClient(t.url);
    const res = await bearer.patch<{ name: string }>('/api/users/me', { name: 'Bearer' }, {
      headers: { authorization: `Bearer ${client.cookie('inkflow_at')}` },
    });
    expect(res.status).toBe(200);
  });

  it('resets a forgotten password (single use, revokes sessions)', async () => {
    const email = uniqueEmail('reset');
    const client = await signUp(t.url, 'Reset Me', email);
    const anon = new TestClient(t.url);
    expect((await anon.post('/api/auth/forgot-password', { email })).status).toBe(200);
    expect((await anon.post('/api/auth/forgot-password', { email: uniqueEmail('ghost') })).status).toBe(200);
    const mail = await waitForEmail(email, 'Reset your Inkflow password');
    const token = tokenFromText(mail.text);
    const newPassword = 'brand-new-password-7';
    const reset = await anon.post('/api/auth/reset-password', { token, password: newPassword });
    expect(reset.status).toBe(200);
    expect((await anon.post('/api/auth/reset-password', { token, password: newPassword })).status).toBe(400);
    // Existing sessions were revoked.
    expect((await client.get('/api/auth/me')).status).toBe(401);
    expect((await anon.post('/api/auth/login', { email, password: PASSWORD })).status).toBe(401);
    expect((await anon.post('/api/auth/login', { email, password: newPassword })).status).toBe(200);
  });

  it('changes the password and lists/revokes sessions', async () => {
    const email = uniqueEmail('change');
    const a = await signUp(t.url, 'Changer', email);
    const b = new TestClient(t.url);
    expect((await b.post('/api/auth/login', { email, password: PASSWORD })).status).toBe(200);
    const wrong = await a.post('/api/auth/change-password', { currentPassword: 'nope', newPassword: 'another-password-9' });
    expect(wrong.status).toBe(400);
    const changed = await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'another-password-9' });
    expect(changed.status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);

    const c = new TestClient(t.url);
    await c.post('/api/auth/login', { email, password: 'another-password-9' });
    const sessions = await a.get<SessionDto[]>('/api/auth/sessions');
    const otherSession = sessions.body.find((s) => !s.current)!;
    expect((await a.delete(`/api/auth/sessions/${otherSession.id}`)).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await a.delete('/api/auth/sessions/not-a-session')).status).toBe(404);
  });

  it('reports providers and hides unconfigured OAuth routes', async () => {
    const anon = new TestClient(t.url);
    const providers = await anon.get('/api/auth/providers');
    expect(providers.body).toEqual({ password: true, google: false, github: false });
    expect((await anon.get('/api/auth/oauth/google')).status).toBe(404);
    expect((await anon.get('/api/auth/oauth/github/callback')).status).toBe(404);
  });

  it('returns uniform validation errors', async () => {
    const anon = new TestClient(t.url);
    const res = await anon.post<{ error: { code: string; details: { path: string[] }[]; requestId: string } }>(
      '/api/auth/register',
      { email: 'not-an-email', password: 'short', name: '' },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d) => d.path[0])).toEqual(expect.arrayContaining(['email', 'password', 'name']));
    expect(res.body.error.requestId).toBeTruthy();
  });
});

describe('auth without mandatory email verification', () => {
  it('signs in immediately after registration', async () => {
    const relaxed = await startApp({ REQUIRE_EMAIL_VERIFICATION: 'false' });
    try {
      const client = new TestClient(relaxed.url);
      const email = uniqueEmail('relaxed');
      const reg = await client.post<RegisterResponse>('/api/auth/register', { email, password: PASSWORD, name: 'Quick Start' });
      expect(reg.status).toBe(201);
      expect(reg.body.requiresVerification).toBe(false);
      expect(client.cookie('inkflow_at')).toBeTruthy();
      expect((await client.get<AuthResponse>('/api/auth/me')).body.user).toMatchObject({ email, emailVerified: false });
      // A verification email is still sent.
      await waitForEmail(email, 'Verify your email');
    } finally {
      await relaxed.close();
    }
  });
});
