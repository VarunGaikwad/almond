import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockCloud } from './auth-fixture';
import { emptyData } from '../../src/lib/finance';

test.beforeEach(async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your money, in balance.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit .*\$/ }).first()).toBeVisible();
});

test('transaction create, edit, search, reload, delete and transfer', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const initial = await page.locator('.hero-number').innerText();
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount in US dollars' }).fill('12.34');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Browser test coffee');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await page.getByRole('searchbox').fill('Browser test coffee');
  await page.getByRole('button', { name: 'Edit Browser test coffee, $12.34' }).click();
  await page.getByRole('textbox', { name: 'Amount in US dollars' }).fill('15.50');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('button', { name: 'Edit Browser test coffee, $15.50' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit Browser test coffee, $15.50' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Browser test coffee, $15.50' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Edit Browser test coffee/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.hero-number')).toHaveText(initial);
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount in US dollars' }).fill('100.00');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Move money');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.hero-number')).toHaveText(initial);
  expect(errors).toEqual([]);
});

test('fresh workspace, account/category/budget editing and JSON backup round trip', async ({ page }) => {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  page.once('dialog', d => d.accept());
  await page.getByLabel('Import Almond backup').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'almond', version: 1, data: emptyData() })) });
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A place for every penny.' })).toBeVisible();
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  await page.getByLabel('Account name').fill('My bank');
  await page.getByLabel('Opening balance (USD)').fill('100.00');
  await page.getByRole('button', { name: 'Save account' }).click();
  await expect(page.getByRole('heading', { name: 'My bank' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Garden');
  await page.getByRole('button', { name: 'Save category' }).click();
  await expect(page.getByRole('button', { name: 'Garden', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Budgets', exact: true }).click();
  await page.getByRole('button', { name: 'Create budget', exact: true }).click();
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Garden' });
  await page.getByLabel('Monthly limit (USD)').fill('150.00');
  await page.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('button', { name: 'Edit Garden budget' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  page.once('dialog', d => d.accept());
  await page.getByLabel('Import Almond backup').setInputFiles(backupPath!);
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Everyday account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My bank', exact: true })).toHaveCount(0);
});

test('production PWA reloads offline and persists an offline edit', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Your money, in balance.' })).toBeVisible();
  await expect(page.getByText('You’re offline. Keep going', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount in US dollars' }).fill('9.99');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Offline groceries');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Offline groceries, $9.99' })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('You’re offline. Keep going', { exact: false })).not.toBeVisible();
});

test('light and dark dashboard accessibility; mobile routes have no horizontal overflow', async ({ page }, testInfo) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  const issues = (results: Awaited<ReturnType<AxeBuilder['analyze']>>) => results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }));
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(issues(results)).toEqual([]);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('html').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(issues(results)).toEqual([]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Transactions', exact: true })).not.toBeVisible();
  for (const [name, heading] of [
    ['Overview', 'Your money, in balance.'], ['Transactions', 'The little things add up.'],
    ['Budgets', 'Room for what matters.'], ['Accounts', 'A place for every penny.'],
    ['Reports', 'See the bigger picture.'], ['Settings', 'Make yourself at home.'],
  ]) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('mobile-settings.png'), fullPage: true });
  for (const viewport of [{ width: 812, height: 375 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('a workspace modal restores keyboard focus', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Add transaction', exact: true });
  await opener.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(opener).toBeFocused();
});
