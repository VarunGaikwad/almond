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

test('month selector stays stable and sidebar keeps only the useful settings link', async ({ page }) => {
  await page.evaluate(() => document.fonts.ready);
  const picker = page.locator('.month-picker');
  const month = page.getByLabel('Selected month');
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 1050 });
    await month.fill('2026-01');
    const initial = await picker.boundingBox();
    expect(initial).not.toBeNull();
    for (let index = 1; index <= 12; index++) {
      await expect(month).toHaveValue(`2026-${String(index).padStart(2, '0')}`);
      const bounds = await picker.boundingBox();
      expect(bounds?.width).toBe(initial!.width);
      expect(bounds?.height).toBe(initial!.height);
      expect(bounds?.x).toBe(initial!.x);
      expect(await picker.locator('label').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Next month', exact: true }).click();
    }
    await expect(month).toHaveValue('2027-01');
    await page.getByRole('button', { name: 'Previous month', exact: true }).click();
    await expect(month).toHaveValue('2026-12');
  }
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Main navigation' });
  await expect(sidebar.getByText('Your personal space')).toHaveCount(0);
  await expect(sidebar.getByText('Manage your account')).toHaveCount(0);
  await sidebar.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make yourself at home.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account settings', exact: true })).toBeVisible();
});

test('empty spending breakdown is centered on desktop and mobile', async ({ page }) => {
  await page.getByLabel('Selected month').fill('1900-01');
  const card = page.locator('.spending');
  const empty = card.locator('.empty-state');
  await expect(empty.getByRole('heading', { name: 'Nothing spent yet' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 1050 });
    const bounds = await card.boundingBox();
    const heading = await card.locator('.card-heading').boundingBox();
    const title = await empty.locator('h3').boundingBox();
    const mark = await empty.locator('.empty-mark').boundingBox();
    const detail = await empty.locator('p').boundingBox();
    const centerX = bounds!.x + bounds!.width / 2;
    expect(Math.abs(title!.x + title!.width / 2 - centerX)).toBeLessThan(1);
    expect(Math.abs(detail!.x + detail!.width / 2 - centerX)).toBeLessThan(1);
    const bodyCenterY = (heading!.y + heading!.height + bounds!.y + bounds!.height - 1) / 2;
    const contentCenterY = (mark!.y + detail!.y + detail!.height) / 2;
    expect(Math.abs(contentCenterY - bodyCenterY)).toBeLessThan(1);
    expect(await empty.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
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
  const bottomNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  const more = bottomNav.getByRole('button', { name: 'More', exact: true });
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(issues(results)).toEqual([]);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.locator('html').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(issues(results)).toEqual([]);
  await more.click();
  const sidebar = page.getByRole('complementary', { name: 'Main navigation' });
  const close = sidebar.getByRole('button', { name: 'Close more navigation' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(sidebar.getByRole('link', { name: 'Settings', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expect(page.locator('.main-shell')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(bottomNav.getByRole('link', { name: 'Transactions', exact: true })).toBeVisible();
  for (const [name, heading] of [
    ['Overview', 'Your money, in balance.'], ['Transactions', 'The little things add up.'],
    ['Budgets', 'Room for what matters.'], ['Accounts', 'A place for every penny.'],
    ['Schedules', 'A little planning ahead.'], ['Goals', 'A little closer every day.'],
    ['Reports', 'See the bigger picture.'], ['Settings', 'Make yourself at home.'],
  ]) {
    const primary = ['Overview', 'Transactions', 'Accounts', 'Budgets'].includes(name);
    if (!primary) await more.click();
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    if (primary) await expect(bottomNav.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    else await expect(more).toHaveAttribute('aria-current', 'true');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('mobile-settings.png'), fullPage: true });
  await more.click();
  for (const viewport of [{ width: 812, height: 375 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await expect(bottomNav).not.toBeVisible();
    await expect(page.locator('.main-shell')).not.toHaveAttribute('inert', '');
    await expect(page.locator('.sidebar').getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('mobile bottom navigation preserves history and clears content and notifications', async ({ page }, testInfo) => {
  const bottomNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 812 });
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav.getByRole('link')).toHaveText(['Overview', 'Transactions', 'Accounts', 'Budgets']);
    const bounds = (await bottomNav.boundingBox())!;
    expect(bounds.y + bounds.height).toBe(812);
    for (const item of await bottomNav.locator('a, button').all()) {
      const target = (await item.boundingBox())!;
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(await item.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.locator('.page-footer').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = (await page.locator('.page-footer').boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(bounds.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await bottomNav.getByRole('link', { name: 'Transactions', exact: true }).click();
  await expect(page).toHaveURL(/#transactions$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your money, in balance.' })).toBeVisible();
  await expect(bottomNav.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'The little things add up.' })).toBeVisible();
  await page.reload();
  await expect(bottomNav.getByRole('link', { name: 'Transactions', exact: true })).toHaveAttribute('aria-current', 'page');
  await bottomNav.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Close more navigation' }).click();
  await expect(bottomNav.getByRole('button', { name: 'More', exact: true })).toBeFocused();
  await bottomNav.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click({ position: { x: 400, y: 200 } });
  await expect(bottomNav.getByRole('button', { name: 'More', exact: true })).toBeFocused();
  await bottomNav.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  await download;
  const notification = (await page.getByRole('status').boundingBox())!;
  expect(notification.y + notification.height).toBeLessThan((await bottomNav.boundingBox())!.y);
  await page.screenshot({ path: testInfo.outputPath('mobile-bottom-navigation.png') });
});

test.describe('automatic currency reporting', () => {
  test.use({ serviceWorkers: 'block' });

test('per-account yen and rupee currencies survive edits, reload and backup restore', async ({ page }) => {
  await page.route('**/api/exchange-rates?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    const source = params.get('source')!;
    const date = params.get('date')!;
    const rates = {
      USD: { USD: '1', JPY: '150', INR: '80' },
      JPY: { USD: '0.00666667', JPY: '1', INR: '0.53333333' },
      INR: { USD: '0.0125', JPY: '1.875', INR: '1' },
    };
    expect(source in rates).toBe(true);
    await route.fulfill({ json: { source, date, asOf: date, rates: rates[source as keyof typeof rates] } });
  });
  const usdBalance = Number((await page.locator('.hero-number').innerText()).replace(/[^\d.-]/g, ''));
  const total = (amount: number, currency: string) => new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency }).format(amount);
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  for (const [currency, name, opening] of [['JPY', 'Tokyo wallet', '5000'], ['INR', 'Delhi wallet', '1000.50']]) {
    await page.getByRole('button', { name: 'Add account', exact: true }).click();
    await page.getByLabel('Account name').fill(name);
    await page.getByLabel('Currency', { exact: true }).selectOption(currency);
    await page.getByLabel(`Opening balance (${currency})`).fill(opening);
    await page.getByRole('button', { name: 'Save account' }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Edit Tokyo wallet', exact: true }).click();
  await expect(page.getByLabel('Currency', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Opening balance (JPY)')).toHaveValue('5000');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByLabel('View currency', { exact: true })).toHaveCount(0);
  await expect(page.locator('.hero-number')).toHaveText(total(usdBalance + 33.33 + 12.51, 'USD'));
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await page.getByLabel('Account', { exact: true }).selectOption({ label: 'Tokyo wallet (JPY)' });
  await page.getByLabel('Amount in JPY').fill('500.50');
  await page.getByLabel('Title', { exact: true }).fill('Tokyo lunch');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Enter a whole yen amount');
  await page.getByLabel('Amount in JPY').fill('500');
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(page.getByLabel('To account').locator('option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Expense', exact: true }).click();
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.hero-number')).toHaveText(total(usdBalance + 30 + 12.51, 'USD'));
  await expect(page.getByRole('button', { name: /^Edit Tokyo lunch, ¥500/ })).toBeVisible();
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  for (const [name, balance] of [['Tokyo wallet', '¥4,500'], ['Delhi wallet', '₹1,000.50']]) {
    await expect(page.locator('.account-card').filter({ has: page.getByRole('heading', { name, exact: true }) }).locator('.account-balance')).toHaveText(balance);
  }
  await page.getByRole('button', { name: 'Make Tokyo wallet primary', exact: true }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.hero-number')).toHaveText(total(usdBalance * 150 + 4500 + 1876, 'JPY'));
  await page.getByRole('link', { name: 'Budgets', exact: true }).click();
  await page.getByLabel('View currency', { exact: true }).selectOption('JPY');
  await page.getByRole('button', { name: 'Create budget', exact: true }).click();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('JPY');
  await page.getByLabel('Category', { exact: true }).selectOption('food');
  await page.getByLabel('Monthly limit (JPY)').fill('2000');
  await page.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('button', { name: 'Edit Food & dining budget', exact: true })).toContainText('¥500');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  const backup = await (await downloadPromise).path();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Import Almond backup').setInputFiles(backup!);
  await expect(page.getByRole('status')).toContainText('Backup restored.');
  await page.reload();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.hero-number')).toHaveText(total(usdBalance * 150 + 4500 + 1876, 'JPY'));
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.locator('.account-card').filter({ hasText: 'Tokyo wallet' }).getByText('Primary', { exact: true })).toBeVisible();
  for (const [name, currency, opening, balance] of [['Tokyo wallet', 'JPY', '5000', '¥4,500'], ['Delhi wallet', 'INR', '1000.50', '₹1,000.50']]) {
    await expect(page.locator('.account-card').filter({ has: page.getByRole('heading', { name, exact: true }) }).locator('.account-balance')).toHaveText(balance);
    await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    await expect(page.getByLabel('Currency', { exact: true })).toBeDisabled();
    await expect(page.getByLabel(`Opening balance (${currency})`)).toHaveValue(opening);
    await page.getByRole('button', { name: 'Save account', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Make Delhi wallet primary', exact: true }).click();
  await expect(page.locator('.account-card').filter({ hasText: 'Delhi wallet' }).getByText('Primary', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.hero-number')).toHaveText(total(usdBalance * 80 + 2400 + 1000.50, 'INR'));
});
});

test('empty accounts can be deleted; accounts with history can be archived and restored', async ({ page }) => {
  const balance = await page.locator('.hero-number').innerText();
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Cash wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cash wallet', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Everyday account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeDisabled();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive account', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Select a replacement primary account before archiving this account.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.account-card').filter({ hasText: 'Everyday account' }).getByText('Primary', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Make Rainy day fund primary', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Everyday account', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive account', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.account-card').filter({ has: page.getByRole('heading', { name: 'Everyday account', exact: true }) })).toContainText('Archived');
  await page.reload();
  await page.getByRole('button', { name: 'Edit Everyday account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore account', exact: true })).toBeVisible();
  await page.getByLabel('Account name').fill('Archived everyday');
  await page.getByRole('button', { name: 'Save account', exact: true }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.hero-number')).not.toHaveText(balance); // Deleted cash opening balance was removed.
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await expect(page.getByLabel('Account', { exact: true }).locator('option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(page.getByLabel('To account').locator('option')).toHaveCount(1); // No archived destination offered.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await page.getByRole('button', { name: /Edit Monthly salary,/ }).click();
  await expect(page.getByLabel('Account', { exact: true }).locator('option:checked')).toContainText('Archived everyday');
  await page.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Archived everyday', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Restore account', exact: true }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  await expect(page.getByLabel('Account', { exact: true }).locator('option')).toHaveCount(2);
});

test('a workspace modal restores keyboard focus', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Add transaction', exact: true });
  await opener.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(opener).toBeFocused();
});
