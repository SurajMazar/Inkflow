import { expect, test } from '@playwright/test';
import { extractLink, login, logout, query, registerAndVerify, uniqueUser, waitForEmail } from '../helpers';

test.describe('authentication', () => {
  test('register, verify email, sign out, sign in, reset password', async ({ page }) => {
    const user = uniqueUser('auth');
    await registerAndVerify(page, user);

    const [row] = await query<{ email_verified_at: Date | null; password_hash: string }>(
      'SELECT email_verified_at, password_hash FROM users WHERE email = $1',
      [user.email],
    );
    expect(row?.email_verified_at).not.toBeNull();
    // Passwords are never stored in plaintext.
    expect(row?.password_hash).not.toContain(user.password);
    expect(row?.password_hash).toMatch(/^\$argon2id\$/);

    await page.getByTestId('create-workspace-name').waitFor();
    await logout(page);

    // Wrong password is rejected.
    await page.getByTestId('login-email').fill(user.email);
    await page.getByTestId('login-password').fill('not-the-password-1');
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('alert')).toContainText(/incorrect|invalid/i);

    await login(page, user);
    await expect(page.getByTestId('create-workspace-name')).toBeVisible();
    await logout(page);

    // Forgot password → email → reset → sign in with the new password.
    await page.goto('/forgot-password');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByRole('button', { name: /send|reset/i }).click();
    const body = await waitForEmail(user.email, /reset/i);
    await page.goto(extractLink(body, '/reset-password'));
    const newPassword = `${user.password}-new1`;
    const fields = page.getByLabel(/password/i);
    await fields.first().fill(newPassword);
    if ((await fields.count()) > 1) await fields.nth(1).fill(newPassword);
    await page.getByRole('button', { name: /reset|update|save/i }).click();
    await page.waitForURL(/\/login/);
    await login(page, { ...user, password: newPassword });
    await expect(page.getByTestId('create-workspace-name')).toBeVisible();
  });

  test('unverified accounts cannot sign in', async ({ page }) => {
    const user = uniqueUser('unverified');
    await page.goto('/register');
    await page.getByTestId('register-name').fill(user.name);
    await page.getByTestId('register-email').fill(user.email);
    await page.getByTestId('register-password').fill(user.password);
    await page.getByTestId('register-submit').click();
    await expect(page.getByTestId('register-success')).toBeVisible();
    await page.goto('/login');
    await page.getByTestId('login-email').fill(user.email);
    await page.getByTestId('login-password').fill(user.password);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText(/verify/i).first()).toBeVisible();
  });
});
