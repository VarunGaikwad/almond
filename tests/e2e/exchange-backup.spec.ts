import { readFile } from 'node:fs/promises';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyData, type FinanceData } from '../../src/lib/finance';
import { mockCloud } from './auth-fixture';

function twoCurrencies(): FinanceData {
  return {
    ...emptyData(),
    accounts: [
      { id: 'usd', name: 'Dollar wallet', type: 'cash', currency: 'USD', openingBalance: 100, color: '#6d8163' },
      { id: 'yen', name: 'Yen wallet', type: 'cash', currency: 'JPY', openingBalance: 0, color: '#9297b8' },
    ],
    transactions: [
      { id: 'yen-income', title: 'One yen earned', type: 'income', accountId: 'yen', categoryId: 'income', amount: 1, date: '2023-01-01' },
      { id: 'yen-expense', title: 'Two yen spent', type: 'expense', accountId: 'yen', categoryId: 'food', amount: 2, date: '2023-01-02' },
    ],
  };
}

async function snapshot(page: Page): Promise<FinanceData> {
  return page.evaluate(() => new Promise<FinanceData>((resolve, reject) => {
    const request = indexedDB.open('almond-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction('workspacesV2').objectStore('workspacesV2').get('user:browser-test');
      read.onerror = () => { database.close(); reject(read.error); };
      read.onsuccess = () => { database.close(); resolve(read.result?.data); };
    };
  }));
}

async function openWorkspace(page: Page, data: FinanceData) {
  const externalRequests: string[] = [];
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:3100') {
      externalRequests.push(route.request().url());
      await route.abort();
    } else await route.fallback();
  });
  await mockCloud(page, true, data);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your money, in balance.', exact: true })).toBeVisible();
  // Wait for the remote fixture, not the initially empty signed-in workspace.
  await expect.poll(() => snapshot(page)).toEqual(data);
  await expect(page.getByText('All changes synced', { exact: true }).first()).toBeVisible();
  return externalRequests;
}

async function reports(page: Page) {
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'See the bigger picture.', exact: true })).toBeVisible();
  await page.getByLabel('Selected month', { exact: true }).fill('2023-01');
  return page.getByRole('region', { name: 'Manual currency reporting', exact: true });
}

async function offlineReload(page: Page, context: BrowserContext) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('You’re offline. Keep going', { exact: false })).toBeVisible();
}

async function exportBackup(page: Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('main').getByRole('button', { name: 'Export backup', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^almond-backup-.*\.json$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  return { path: path!, json: JSON.parse(await readFile(path!, 'utf8')) };
}

async function restore(page: Page, backup: unknown) {
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Import Almond backup', { exact: true }).setInputFiles({
    name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByRole('status')).toContainText('Backup restored.');
}

test('manual direct rates round half units without changing ledgers, survive offline edits, and can be deleted', async ({ page, context }) => {
  const data = twoCurrencies();
  const externalRequests = await openWorkspace(page, data);
  const reporting = await reports(page);
  await expect(reporting.getByRole('status')).toContainText('Combined total unavailable. Missing valid direct rates: JPY → USD');
  // Only original-currency amounts are shown until every direct rate exists.
  await expect(reporting.locator('dl')).toHaveCount(2);
  await expect(reporting.locator('dl').nth(0).getByRole('definition')).toHaveText(['$1.00', '$0.00', '$0.00', '$0.00']);
  await expect(reporting.locator('dl').nth(1).getByRole('definition')).toHaveText(['-¥1', '¥1', '¥2', '-¥1']);
  await reporting.getByRole('button', { name: 'Add manual rate', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Add manual rate', exact: true });
  await dialog.getByLabel('Source currency', { exact: true }).selectOption('JPY');
  await dialog.getByLabel('Target currency', { exact: true }).selectOption('USD');
  await dialog.getByLabel('Rate (target units per 1 source unit)', { exact: true }).fill('0.005');
  await dialog.getByLabel('Rate as-of date', { exact: true }).fill('2023-01-01');
  await dialog.getByRole('button', { name: 'Save rate', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(reporting.locator('dl')).toHaveCount(3);
  await expect(reporting.locator('dl').first().getByRole('definition')).toHaveText(['$0.99', '$0.01', '$0.01', '$0.00']);
  await expect(reporting.getByText('1 JPY = 0.005 USD · As of 2023-01-01 · Stale (older than 7 days)', { exact: true })).toBeVisible();
  await expect(reporting.getByRole('status')).toContainText('Stale rates (older than 7 days) are being used.');
  await expect.poll(async () => (await snapshot(page)).exchangeRates).toEqual([
    { id: expect.any(String), source: 'JPY', target: 'USD', rate: '0.005', asOf: '2023-01-01' },
  ]);
  await page.reload();
  await expect(reporting.getByRole('button', { name: 'Edit rate JPY to USD', exact: true })).toBeVisible();
  await offlineReload(page, context);
  await reporting.getByRole('button', { name: 'Edit rate JPY to USD', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Edit manual rate', exact: true });
  await expect(dialog.getByLabel('Rate (target units per 1 source unit)', { exact: true })).toHaveValue('0.005');
  await dialog.getByLabel('Rate (target units per 1 source unit)', { exact: true }).fill('0.015');
  await dialog.getByRole('button', { name: 'Save rate', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('Selected month', { exact: true }).fill('2023-01');
  await expect(reporting.locator('dl').first().getByRole('definition')).toHaveText(['$0.98', '$0.02', '$0.03', '-$0.01']);
  await reporting.getByRole('button', { name: 'Edit rate JPY to USD', exact: true }).click();
  page.once('dialog', confirmation => confirmation.accept());
  await page.getByRole('dialog', { name: 'Edit manual rate', exact: true }).getByRole('button', { name: 'Delete rate', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(reporting.getByRole('status')).toContainText('Combined total unavailable.');
  await expect(reporting.locator('dl')).toHaveCount(2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(reporting.getByText('No manual rates saved.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).exchangeRates).toEqual([]);
  const saved = await snapshot(page);
  expect(saved.accounts).toEqual(data.accounts);
  expect(saved.transactions).toEqual(data.transactions);
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  for (const [name, balance] of [['Dollar wallet', '$1.00'], ['Yen wallet', '-¥1']]) {
    const card = page.locator('.account-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card.locator('.account-balance')).toHaveText(balance);
  }
  expect(externalRequests).toEqual([]);
});

test('downloaded v2 backup preserves every collection; legacy restore clears additions and invalid backups are atomic', async ({ page, context }) => {
  const data = twoCurrencies();
  data.schedules = [{ id: 'rent', title: 'Planned rent', amount: 25, type: 'expense', accountId: 'usd', categoryId: 'home', frequency: 'monthly', anchorDate: '2023-01-31', nextDue: '2023-02-28', notes: 'Keep schedule metadata' }];
  data.transactions.push({ id: 'rent-posted', title: 'Posted rent', amount: 25, type: 'expense', accountId: 'usd', categoryId: 'home', date: '2023-01-31', scheduleId: 'rent', scheduledFor: '2023-01-31', notes: 'Keep occurrence metadata' });
  data.budgets = [{ id: 'flexible', categoryIds: ['home', 'food'], currency: 'USD', amount: 5000, startDate: '2023-01-15', endDate: '2023-02-14', transactionIds: ['rent-posted'] }];
  data.goals = [{ id: 'goal', name: 'Home spending', kind: 'spending', currency: 'USD', target: 5000, targetDate: '2023-12-31', transactionIds: ['rent-posted'] }];
  data.exchangeRates = [{ id: 'manual-yen', source: 'JPY', target: 'USD', rate: '0.005', asOf: '2023-01-01' }];
  const externalRequests = await openWorkspace(page, data);
  const exported = await exportBackup(page);
  expect(exported.json).toEqual({ format: 'almond', version: 2, exportedAt: expect.any(String), data });
  expect(Number.isNaN(Date.parse(exported.json.exportedAt))).toBe(false);

  const legacy = emptyData();
  await restore(page, { format: 'almond', version: 1, data: legacy });
  await expect.poll(() => snapshot(page)).toEqual(legacy);
  const cleared = await exportBackup(page);
  expect(cleared.json.data).toEqual(legacy);
  for (const collection of ['schedules', 'goals', 'exchangeRates']) expect(cleared.json.data).not.toHaveProperty(collection);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Make yourself at home.', exact: true })).toBeVisible();
  await expect.poll(() => snapshot(page)).toEqual(legacy);

  // Import the actual downloaded file rather than recreating its envelope in the test.
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Import Almond backup', { exact: true }).setInputFiles(exported.path);
  await expect(page.getByRole('status')).toContainText('Backup restored.');
  await expect.poll(() => snapshot(page)).toEqual(data);
  await expect(page.getByText('All changes synced', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Make yourself at home.', exact: true })).toBeVisible();
  await expect.poll(() => snapshot(page)).toEqual(data);
  expect((await exportBackup(page)).json.data).toEqual(data);

  for (const invalid of [
    { ...exported.json, version: 99 },
    { ...exported.json, data: { ...data, exchangeRates: [{ ...data.exchangeRates[0], rate: '0' }] } },
  ]) {
    await page.getByLabel('Import Almond backup', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await expect(page.getByLabel('Import Almond backup', { exact: true })).toHaveValue('');
    await expect(page.getByRole('status')).toContainText('This backup has invalid financial records. Nothing was imported.');
    expect(await snapshot(page)).toEqual(data);
  }
  await offlineReload(page, context);
  await expect(page.getByRole('heading', { name: 'Make yourself at home.', exact: true })).toBeVisible();
  expect(await snapshot(page)).toEqual(data);
  expect((await exportBackup(page)).json.data).toEqual(data);
  expect(externalRequests).toEqual([]);
});

test('390px Reports and manual-rate dialog fit the viewport and pass axe', async ({ page }) => {
  const externalRequests = await openWorkspace(page, twoCurrencies());
  await reports(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  expect(await noOverflow()).toBe(true);
  const violations = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
  expect(await violations()).toEqual([]);
  await page.getByRole('region', { name: 'Manual currency reporting', exact: true }).getByRole('button', { name: 'Add manual rate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add manual rate', exact: true });
  await expect(dialog).toBeVisible();
  expect(await noOverflow()).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await violations()).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(externalRequests).toEqual([]);
});
