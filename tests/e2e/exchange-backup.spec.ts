import { readFile } from 'node:fs/promises';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { emptyData, localDate, type Currency, type FinanceData, type FxQuote } from '../../src/lib/finance';
import { mockCloud } from './auth-fixture';

function twoCurrencies(): FinanceData {
  return {
    ...emptyData(), primaryAccountId: 'usd',
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

function quote(source: Currency, date: string): FxQuote {
  return { source, date, asOf: date, rates: source === 'JPY'
    ? { USD: date === localDate() ? '0.015' : '0.005', JPY: '1', INR: '0.4' }
    : source === 'USD' ? { USD: '1', JPY: '200', INR: '80' } : { USD: '0.0125', JPY: '2.5', INR: '1' } };
}

async function snapshot(page: Page): Promise<FinanceData> {
  return page.evaluate(() => new Promise<FinanceData>((resolve, reject) => {
    const request = indexedDB.open('almond-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction('workspacesV3').objectStore('workspacesV3').get('user:browser-test');
      read.onerror = () => { database.close(); reject(read.error); };
      read.onsuccess = () => { database.close(); resolve(read.result?.data); };
    };
  }));
}

async function openWorkspace(page: Page, data: FinanceData) {
  const externalRequests: string[] = [];
  const rateRequests: string[] = [];
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:3100') {
      externalRequests.push(route.request().url());
      await route.abort();
    } else await route.fallback();
  });
  // Never reach the real provider, including during automatic historical backfill.
  await page.route('**/api/exchange-rates?*', async route => {
    const url = new URL(route.request().url());
    rateRequests.push(url.search);
    await route.fulfill({ json: quote(url.searchParams.get('source') as Currency, url.searchParams.get('date')!) });
  });
  await mockCloud(page, true, data);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your money, in balance.', exact: true })).toBeVisible();
  await expect.poll(async () => (await snapshot(page))?.accounts).toEqual(data.accounts);
  return { externalRequests, rateRequests };
}

async function reports(page: Page) {
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'See the bigger picture.', exact: true })).toBeVisible();
  await page.getByLabel('Selected month', { exact: true }).fill('2023-01');
  return page.getByRole('region', { name: 'Automatic currency reporting', exact: true });
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

test('automatic latest balances and frozen historical snapshots preserve native ledgers', async ({ page, context }) => {
  const data = twoCurrencies();
  const { externalRequests, rateRequests } = await openWorkspace(page, data);
  const expected = { ...data, transactions: data.transactions.map(t => ({ ...t, fx: quote('JPY', t.date) })) };
  await expect.poll(() => snapshot(page)).toEqual(expected);
  const reporting = await reports(page);
  // The current balance uses .015, not the historical .005 used for flows.
  await expect(page.locator('.hero-number')).toHaveText('$0.98');
  await expect(reporting).not.toContainText('All-account balance');
  await expect(reporting).toContainText('1 JPY = 0.015 USD');
  await expect(page.locator('.stat-card .stat-number')).toHaveText(['$0.01', '$0.01']);
  await expect(page.locator('.report-stat-grid > div').first().locator('strong')).toHaveText('$0.00');
  await expect(page.getByRole('button', { name: /manual rate/i })).toHaveCount(0);
  await expect(page.getByLabel('View currency', { exact: true })).toHaveCount(0);
  expect(rateRequests.some(request => request.includes('date=2023-01-01'))).toBe(true);
  expect(rateRequests.some(request => request.includes(`date=${localDate()}`))).toBe(true);

  // A changed upstream historical response must never rewrite a saved snapshot.
  await page.route('**/api/exchange-rates?*', async route => {
    const url = new URL(route.request().url());
    const next = quote(url.searchParams.get('source') as Currency, url.searchParams.get('date')!);
    if (next.source === 'JPY' && next.date !== localDate()) next.rates.USD = '0.025';
    await route.fulfill({ json: next });
  });
  await page.reload();
  await expect(reporting).toBeVisible();
  await expect(page.locator('.hero-number')).toHaveText('$0.98');
  expect(await snapshot(page)).toEqual(expected);
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Make Yen wallet primary', exact: true }).click();
  expected.primaryAccountId = 'yen';
  await expect.poll(() => snapshot(page)).toEqual(expected);
  await reports(page);
  await expect(reporting).toContainText('Reporting in JPY');
  await expect(page.locator('.hero-number')).toHaveText('¥199');
  await expect(page.locator('.stat-card .stat-number')).toHaveText(['¥1', '¥2']);
  expect((await snapshot(page)).transactions).toEqual(expected.transactions);
  await offlineReload(page, context);
  expect(await snapshot(page)).toEqual(expected);
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  for (const [name, balance] of [['Dollar wallet', '$1.00'], ['Yen wallet', '-¥1']]) {
    const card = page.locator('.account-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card.locator('.account-balance')).toHaveText(balance);
  }
  expect(externalRequests).toEqual([]);
});

test('offline foreign-currency transactions save without a quote and backfill on reconnect', async ({ page, context }) => {
  const { externalRequests } = await openWorkspace(page, twoCurrencies());
  await expect.poll(async () => (await snapshot(page)).transactions.every(t => Boolean(t.fx))).toBe(true);
  await offlineReload(page, context);
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a transaction', exact: true });
  await dialog.getByLabel('Account', { exact: true }).selectOption('yen');
  await dialog.getByLabel('Amount in JPY', { exact: true }).fill('3');
  await dialog.getByLabel('Title', { exact: true }).fill('Offline yen purchase');
  await dialog.getByLabel('Date', { exact: true }).fill('2023-01-03');
  await dialog.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await snapshot(page)).transactions.find(t => t.title === 'Offline yen purchase')).toMatchObject({ amount: 3, accountId: 'yen', date: '2023-01-03' });
  const offline = (await snapshot(page)).transactions.find(t => t.title === 'Offline yen purchase')!;
  expect(offline).not.toHaveProperty('fx');
  await reports(page);
  await expect(page.getByText('Conversion pending for this month.', { exact: false })).toBeVisible();
  await expect(page.locator('.stat-card .stat-number')).toHaveText(['Unavailable', 'Unavailable']);
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect((await snapshot(page)).transactions.find(t => t.id === offline.id)).toEqual(offline);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await snapshot(page)).transactions.find(t => t.id === offline.id)).toEqual({ ...offline, fx: quote('JPY', '2023-01-03') });
  expect(externalRequests).toEqual([]);
});

test('downloaded v3 backup preserves primary, FX and every collection; v1/v2 restores and invalid backups are atomic', async ({ page, context }) => {
  const data = twoCurrencies();
  data.primaryAccountId = 'yen';
  data.transactions = data.transactions.map(t => ({ ...t, fx: quote('JPY', t.date) }));
  data.schedules = [{ id: 'rent', title: 'Planned rent', amount: 25, type: 'expense', accountId: 'usd', categoryId: 'home', frequency: 'monthly', anchorDate: '2023-01-31', nextDue: '2023-02-28', notes: 'Keep schedule metadata' }];
  data.transactions.push({ id: 'rent-posted', title: 'Posted rent', amount: 25, type: 'expense', accountId: 'usd', categoryId: 'home', date: '2023-01-31', scheduleId: 'rent', scheduledFor: '2023-01-31', notes: 'Keep occurrence metadata', fx: quote('USD', '2023-01-31') });
  data.budgets = [{ id: 'flexible', categoryIds: ['home', 'food'], currency: 'USD', amount: 5000, startDate: '2023-01-15', endDate: '2023-02-14', transactionIds: ['rent-posted'] }];
  data.goals = [{ id: 'goal', name: 'Home spending', kind: 'spending', currency: 'USD', target: 5000, targetDate: '2023-12-31', transactionIds: ['rent-posted'] }];
  // Old manual metadata remains lossless, but does not drive automatic reporting.
  data.exchangeRates = [{ id: 'manual-yen', source: 'JPY', target: 'USD', rate: '0.005', asOf: '2023-01-01' }];
  const { externalRequests } = await openWorkspace(page, data);
  const exported = await exportBackup(page);
  expect(exported.json).toEqual({ format: 'almond', version: 3, exportedAt: expect.any(String), data });
  expect(Number.isNaN(Date.parse(exported.json.exportedAt))).toBe(false);

  for (const version of [1, 2]) {
    const legacy = { ...emptyData(), accounts: [data.accounts[0]] };
    await restore(page, { format: 'almond', version, data: legacy });
    const normalized = { ...legacy, primaryAccountId: 'usd' };
    await expect.poll(() => snapshot(page)).toEqual(normalized);
    const cleared = await exportBackup(page);
    expect(cleared.json.version).toBe(3);
    expect(cleared.json.data).toEqual(normalized);
    for (const collection of ['schedules', 'goals', 'exchangeRates']) expect(cleared.json.data).not.toHaveProperty(collection);
  }

  // Import the actual downloaded file rather than recreating its envelope.
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
    { ...exported.json, data: { ...data, primaryAccountId: 'missing' } },
    { ...exported.json, data: { ...data, transactions: [{ ...data.transactions[0], fx: { ...data.transactions[0].fx, rates: { USD: '0', JPY: '1', INR: '0.4' } } }] } },
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

test('390px automatic Reports fit the viewport and pass axe without manual controls', async ({ page }) => {
  const { externalRequests } = await openWorkspace(page, twoCurrencies());
  const reporting = await reports(page);
  await expect(page.locator('.hero-number')).toHaveText('$0.98');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await reporting.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
  expect(violations).toEqual([]);
  await reporting.locator('summary').click();
  await expect(reporting.locator('.exchange-explanation')).toBeVisible();
  expect(await reporting.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('.exchange-reporting').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await expect(page.getByRole('button', { name: /manual rate/i })).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});
