import { test, expect } from '@playwright/test';
import { mockCloud } from './auth-fixture';

test('requests a reset link without revealing account existence', async ({ page }) => {
  await mockCloud(page, false);
  await page.route('**/api/auth/request-password-reset', route => route.fulfill({ json: { status: true } }));
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email address').fill('test@example.com');
  const request = page.waitForRequest('**/api/auth/request-password-reset');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  expect((await request).postDataJSON()).toEqual({ email: 'test@example.com', redirectTo: 'http://127.0.0.1:3100/reset-password' });
  await expect(page.getByRole('status')).toContainText('If an account exists');
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
});

test('validates confirmation, handles expired tokens, and resets without signing in', async ({ page }) => {
  let invalid = true;
  let requests = 0;
  await page.route('**/api/auth/reset-password', async route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ token: 'test-token', newPassword: 'replacement-password' });
    await route.fulfill(invalid
      ? { status: 400, json: { code: 'INVALID_TOKEN', message: 'Invalid token' } }
      : { json: { status: true } });
  });
  await page.goto('/reset-password?token=test-token');
  await page.getByLabel('Password', { exact: true }).fill('replacement-password');
  await page.getByLabel('Confirm password').fill('different-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Passwords do not match.');
  expect(requests).toBe(0);
  await page.getByLabel('Confirm password').fill('replacement-password');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('invalid or has expired');
  await expect(page.getByRole('main').getByRole('alert')).toBeFocused();
  invalid = false;
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your password has been reset');
  await expect(page).toHaveURL(/reset-password/);
});

test('rejects missing or invalid link parameters and permits requesting another link', async ({ page }) => {
  for (const path of ['/reset-password', '/reset-password?error=INVALID_TOKEN', '/reset-password?token=test-token&error=INVALID_TOKEN']) {
    await page.goto(path);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('invalid or has expired');
    await expect(page.getByRole('button', { name: 'Reset password', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Request a new link', exact: true }).click();
    await expect(page).toHaveURL(/forgot-password$/);
  }
});

test('recovery requests can be retried after a service error', async ({ page }) => {
  let failing = true;
  await page.route('**/api/auth/request-password-reset', route => route.fulfill(failing
    ? { status: 503, json: { message: 'Email service unavailable. Please try again.' } }
    : { json: { status: true } }));
  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill('test@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Email service unavailable');
  await expect(page.getByRole('main').getByRole('alert')).toBeFocused();
  failing = false;
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists');
});
