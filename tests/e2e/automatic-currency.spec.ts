import { test, expect, type Page } from '@playwright/test';
import { emptyData, localDate, type FinanceData } from '../../src/lib/finance';
import { mockCloud } from './auth-fixture';

const today = localDate();
const yesterdayDate = new Date();
yesterdayDate.setDate(yesterdayDate.getDate() - 1);
const yesterday = localDate(yesterdayDate);
function fixture(): FinanceData {
  return { ...emptyData(), primaryAccountId: 'yen', accounts: [
    { id: 'yen', name: 'Yen wallet', type: 'cash', currency: 'JPY', openingBalance: 10000, color: '#6d8163' },
    { id: 'usd', name: 'Dollar wallet', type: 'cash', currency: 'USD', openingBalance: 10000, color: '#9297b8' },
  ], transactions: [{ id: 'coffee', title: 'Dollar coffee', type: 'expense', accountId: 'usd', categoryId: 'food', amount: 1000, date: yesterday }] };
}
async function saved(page: Page): Promise<FinanceData> {
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
async function open(page: Page, options = { fail: false, latestRate: '150' }, data = fixture()) {
  const requests: string[] = [];
  await page.route('**/api/exchange-rates?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    const source = params.get('source')!;
    const date = params.get('date')!;
    requests.push(`${source}:${date}`);
    if (options.fail) { await route.fulfill({ status: 503, json: { error: 'Offline test' } }); return; }
    await route.fulfill({ json: { source, date, asOf: date, rates: source === 'USD'
      ? { USD: '1', JPY: date === today ? options.latestRate : '150', INR: '85' }
      : { USD: '0.00666667', JPY: '1', INR: '0.56666667' } } });
  });
  await mockCloud(page, true, data);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your money, in balance.', exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page))?.accounts.length).toBe(data.accounts.length);
  // Yesterday can belong to the previous month on the first day of a month.
  await page.getByLabel('Selected month', { exact: true }).fill(yesterday.slice(0, 7));
  return requests;
}

test('JPY primary uses saved USD expense rates and today rates only revalue current balances', async ({ page }) => {
  const options = { fail: false, latestRate: '150' };
  await open(page, options);
  await expect.poll(async () => (await saved(page)).transactions[0].fx?.rates.JPY).toBe('150');
  await expect(page.locator('.hero-number')).toHaveText('¥23,500');
  await expect(page.locator('.stat-card').filter({ hasText: 'Expenses' }).locator('.stat-number')).toHaveText('¥1,500');
  expect((await saved(page)).transactions[0].amount).toBe(1000);
  const recent = page.locator('.recent-transactions .transaction-row').filter({ hasText: 'Dollar coffee' });
  await expect(recent).toContainText('¥1,500');
  await expect(recent).toContainText('$10.00');
  await expect(recent).toContainText(yesterday);
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  const fullList = page.locator('.transactions-page .transaction-row').filter({ hasText: 'Dollar coffee' });
  await expect(fullList).toContainText('¥1,500');
  await expect(fullList).toContainText('$10.00');
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.locator('.account-card').filter({ hasText: 'Dollar wallet' }).locator('.account-balance')).toHaveText('$90.00');
  await expect(page.getByLabel('View currency', { exact: true })).toHaveCount(0);
  await expect(page.locator('.account-card').filter({ hasText: 'Yen wallet' }).getByText('Primary', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make Dollar wallet primary', exact: true })).toBeVisible();
  await expect(page.getByText('All changes synced', { exact: true }).first()).toBeVisible();
  options.latestRate = '160';
  await page.reload();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByLabel('Selected month', { exact: true }).fill(yesterday.slice(0, 7));
  await expect(page.locator('.hero-number')).toHaveText('¥24,400');
  await expect(page.locator('.stat-card').filter({ hasText: 'Expenses' }).locator('.stat-number')).toHaveText('¥1,500');
  expect((await saved(page)).transactions[0].fx?.rates.JPY).toBe('150');
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Make Dollar wallet primary', exact: true }).click();
  await expect.poll(async () => (await saved(page)).primaryAccountId).toBe('usd');
  await expect(page.locator('.account-card').filter({ hasText: 'Dollar wallet' }).getByText('Primary', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.locator('.stat-card').filter({ hasText: 'Expenses' }).locator('.stat-number')).toHaveText('$10.00');
});

test('compact reporting discloses details with the keyboard and refreshes without changing the ledger', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
  await open(page);
  await expect.poll(async () => (await saved(page)).transactions[0].fx?.rates.JPY).toBe('150');
  const reporting = page.getByRole('region', { name: 'Automatic currency reporting' });
  const refresh = reporting.getByRole('button', { name: 'Refresh exchange rates', exact: true });
  await expect(refresh).toBeEnabled();
  await expect(reporting).toContainText('Reporting in JPY');
  await expect(reporting).toContainText('1 USD = 150 JPY');
  await expect(reporting).toContainText('Rate dated');
  await expect(reporting).not.toContainText('All-account balance');
  await expect(reporting.getByRole('heading', { name: 'Automatic currency reporting' })).toHaveCount(0);
  await expect(reporting.locator('.exchange-explanation')).toBeHidden();
  const summary = reporting.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(reporting.locator('.exchange-explanation')).toBeVisible();
  await expect(reporting.locator('.exchange-explanation time')).toHaveAttribute('datetime', today);
  await page.keyboard.press('Space');
  await expect(reporting.locator('.exchange-explanation')).toBeHidden();

  const before = await saved(page);
  // Expire the five-minute client cache without firing the hourly refresh timer.
  await page.clock.setFixedTime(new Date(`${today}T12:06:00`));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/exchange-rates?*', async route => {
    await held;
    await route.fallback();
  });
  await refresh.click();
  try {
    await expect(reporting.getByRole('button', { name: 'Loading exchange rates', exact: true })).toBeDisabled();
    await expect(reporting.getByText('Loading exchange rates…', { exact: true })).toBeVisible();
  } finally { release(); }
  await expect(refresh).toBeEnabled();
  await expect(reporting.getByRole('button', { name: 'Retry exchange rates', exact: true })).toHaveCount(0);
  expect(await saved(page)).toEqual(before);
});

test('single-currency reporting stays compact without a rate list', async ({ page }) => {
  const data = fixture();
  data.accounts = [data.accounts[0]];
  data.transactions = [];
  await open(page, undefined, data);
  const reporting = page.getByRole('region', { name: 'Automatic currency reporting' });
  await expect(reporting.getByText('No currency conversion needed.', { exact: true })).toBeVisible();
  await expect(reporting.locator('.exchange-quotes')).toHaveCount(0);
  await expect(reporting.locator('details')).not.toHaveAttribute('open');
});

test('backfills multiple batches and transfer snapshots without waiting for the retry timer', async ({ page }) => {
  const data = fixture();
  data.accounts.push({ ...data.accounts[1], id: 'usd-second', name: 'Second dollar wallet', openingBalance: 0 });
  data.transactions = Array.from({ length: 9 }, (_, index) => ({
    ...data.transactions[0], id: `expense-${index}`, date: `2023-01-${String(index + 1).padStart(2, '0')}`,
  }));
  data.transactions.push({ id: 'transfer', title: 'Dollar transfer', type: 'transfer', accountId: 'usd', toAccountId: 'usd-second', amount: 1000, date: '2023-01-10' });
  await open(page, undefined, data);
  await expect.poll(async () => (await saved(page)).transactions.filter(t => t.fx).length).toBe(10);
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await page.getByLabel('Selected month', { exact: true }).fill('2023-01');
  const transfer = page.locator('.transaction-row').filter({ hasText: 'Dollar transfer' });
  await expect(transfer).toContainText('¥1,500');
  await expect(transfer).toContainText('$10.00');
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.locator('.stat-card').filter({ hasText: 'Expenses' }).locator('.stat-number')).toHaveText('¥13,500');
});

test('a new transaction reuses the saved date rate without waiting a minute', async ({ page }) => {
  await open(page);
  await expect.poll(async () => (await saved(page)).transactions[0].fx?.rates.JPY).toBe('150');
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a transaction', exact: true });
  await dialog.getByLabel('Account', { exact: true }).selectOption('usd');
  await dialog.getByLabel('Amount in US dollars', { exact: true }).fill('5');
  await dialog.getByLabel('Title', { exact: true }).fill('Another dollar purchase');
  await dialog.getByLabel('Date', { exact: true }).fill(yesterday);
  await dialog.getByRole('button', { name: 'Save transaction', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await saved(page)).transactions.find(t => t.title === 'Another dollar purchase')?.fx?.rates.JPY).toBe('150');
  await expect(page.locator('.stat-card').filter({ hasText: 'Expenses' }).locator('.stat-number')).toHaveText('¥2,250');
});

test('failed rates show no partial totals, retry recovers and failures do not loop', async ({ page }) => {
  const options = { fail: true, latestRate: '150' };
  const requests = await open(page, options);
  await expect(page.locator('.hero-number')).toHaveText('Unavailable');
  await expect(page.locator('.stat-card').filter({ hasText: 'Expenses' }).locator('.stat-number')).toHaveText('Unavailable');
  await expect(page.getByRole('region', { name: 'Automatic currency reporting' })).toContainText('No partial total is shown');
  await expect(page.getByRole('button', { name: 'Retry exchange rates', exact: true })).toBeEnabled();
  const reporting = page.getByRole('region', { name: 'Automatic currency reporting' });
  await expect(reporting.locator('details')).not.toHaveAttribute('open');
  await expect(reporting.locator('.exchange-error')).toBeVisible();
  const count = requests.length;
  await page.waitForTimeout(1500);
  expect(requests.length).toBe(count);
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.locator('.account-card').filter({ hasText: 'Dollar wallet' }).locator('.account-balance')).toHaveText('$90.00');
  options.fail = false;
  await page.getByRole('button', { name: 'Retry exchange rates', exact: true }).click();
  await expect.poll(async () => (await saved(page)).transactions[0].fx?.rates.JPY).toBe('150');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.hero-number')).toHaveText('¥23,500');
  await expect(page.locator('.stat-card').filter({ hasText: 'Expenses' }).locator('.stat-number')).toHaveText('¥1,500');
});
