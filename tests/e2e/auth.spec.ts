import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockCloud } from './auth-fixture';
import { emptyData } from '../../src/lib/finance';

const dashboard = 'Your money, in balance.';
async function fillCredentials(page: import('@playwright/test').Page, password = 'a-long-test-password') {
  await page.getByLabel('Email address').fill('test@example.com');
  await page.getByLabel('Password', { exact: true }).fill(password);
}

test('guests are redirected without creating or showing a local workspace', async ({ page }) => {
  await mockCloud(page, false);
  await page.addInitScript(() => localStorage.setItem('almond-workspace', 'user:legacy'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back to your space.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: dashboard })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('almond-authenticated-account'))).toBeNull();
});

test('login shows credential errors, supports password visibility, then opens the workspace', async ({ page }) => {
  await mockCloud(page, false, emptyData());
  await page.goto('/login');
  await fillCredentials(page, 'wrong-password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.form-error')).toHaveText('Invalid email or password.');
  await expect(page.locator('.form-error')).toBeFocused();
  await expect(page.getByLabel('Email address')).toHaveValue('test@example.com');
  await fillCredentials(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: dashboard })).toBeVisible();
  await expect(page.locator('.hero-number')).toHaveText('$0.00');
  expect(await page.evaluate(() => localStorage.getItem('almond-authenticated-account'))).toBe('user:browser-test');
  await page.goto('/register');
  await expect(page).toHaveURL(/\/$/);
});

test('registration validates fields and handles server errors before success', async ({ page }) => {
  const cloud = await mockCloud(page, false, emptyData());
  await page.goto('/login');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel('Your name').fill('Test User');
  await fillCredentials(page, 'short');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  expect(await page.getByLabel('Password', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true);
  await fillCredentials(page);
  cloud.registrationError = true;
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.locator('.form-error')).toHaveText('Unable to create account.');
  cloud.registrationError = false;
  const request = page.waitForRequest('**/api/auth/sign-up/email');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ name: 'Test User', email: 'test@example.com' });
  await expect(page.getByRole('heading', { name: dashboard })).toBeVisible();
});

test('service unavailable fails closed, even with a remembered workspace', async ({ page }) => {
  const cloud = await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: dashboard })).toBeVisible();
  cloud.sessionStatus = 503;
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.auth-unavailable')).toContainText('Sign-in is unavailable');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: dashboard })).toHaveCount(0);
});

test('session expiry locks access and preserves pending edits across reauthentication', async ({ page, context }) => {
  const cloud = await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Edit .*\$/ }).first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount in US dollars' }).fill('2.00');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Preserved offline edit');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  cloud.userId = null;
  await context.setOffline(false);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('almond-authenticated-account'))).toBeNull();
  await context.setOffline(true);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.auth-unavailable')).toContainText('Connect to the internet');
  await context.setOffline(false);
  await fillCredentials(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Preserved offline edit, $2.00' })).toBeVisible();
});

test('account switching never renders the prior account and sign-out removes offline access', async ({ page, context }) => {
  const cloud = await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Edit .*\$/ }).first()).toBeVisible();
  cloud.userId = 'another-account'; cloud.data = emptyData(); cloud.version = 0;
  await page.reload();
  await expect(page.getByRole('heading', { name: dashboard })).toBeVisible();
  await expect(page.locator('.hero-number')).toHaveText('$0.00');
  expect(await page.evaluate(() => localStorage.getItem('almond-authenticated-account'))).toBe('user:another-account');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem('almond-authenticated-account'))).toBeNull();
  await context.setOffline(true);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.auth-unavailable')).toContainText('Connect to the internet');
  await expect(page.getByRole('heading', { name: dashboard })).toHaveCount(0);
});

test('pending changes prevent sign-out', async ({ page, context }) => {
  await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Edit .*\$/ }).first()).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount in US dollars' }).fill('2.00');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Keep me');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Sync or resolve your changes before signing out');
  expect(await page.evaluate(() => localStorage.getItem('almond-authenticated-account'))).toBe('user:browser-test');
});

test('authentication pages are accessible in both themes and fit narrow screens', async ({ page }, testInfo) => {
  await mockCloud(page, false);
  for (const route of ['/login', '/register', '/forgot-password', '/reset-password?token=test-token']) {
    await page.goto(route);
    await expect(page.getByLabel(route.startsWith('/reset-password') ? 'Password' : 'Email address', { exact: true })).toBeVisible();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.screenshot({ path: testInfo.outputPath(`${route.slice(1)}.png`), fullPage: true });
  }
});
