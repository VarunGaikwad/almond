import { test, expect } from '@playwright/test';
import { mockCloud } from './auth-fixture';
import { sampleData } from '../../src/lib/finance';

test('Goals currency picker aligns with its action on desktop and mobile', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/#goals');
  const currency = page.getByLabel('View currency', { exact: true });
  const create = page.getByRole('button', { name: 'Create goal', exact: true });
  await currency.selectOption('JPY');
  for (const width of [1440, 900, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const pickerBox = await page.locator('.currency-picker').boundingBox();
    const selectBox = await currency.boundingBox();
    const buttonBox = await create.boundingBox();
    expect(pickerBox).not.toBeNull();
    expect(selectBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(Math.abs(pickerBox!.height - selectBox!.height)).toBeLessThan(1);
    expect(Math.abs(selectBox!.height - buttonBox!.height)).toBeLessThan(1);
    if (width >= 390) expect(Math.abs(selectBox!.y - buttonBox!.y)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await create.click();
  await expect(page.getByRole('dialog', { name: 'Create goal', exact: true }).getByLabel('Target (JPY)', { exact: true })).toBeVisible();
});

test('create a historical multi-category selected budget and linked goals, edit and reload progress', async ({ page }) => {
  const data = sampleData(); data.budgets = []; data.transactions = [
    { id: 'food-posted', title: 'Historical groceries', amount: 1000, accountId: 'checking', categoryId: 'food', type: 'expense', date: '2023-01-31' },
    { id: 'shop-posted', title: 'Historical shopping', amount: 2000, accountId: 'checking', categoryId: 'shopping', type: 'expense', date: '2023-02-06' },
    { id: 'income-posted', title: 'Historical salary', amount: 5000, accountId: 'checking', categoryId: 'income', type: 'income', date: '2023-01-31' },
  ];
  await mockCloud(page, true, data); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your money, in balance.' })).toBeVisible();
  await page.getByRole('link', { name: 'Budgets', exact: true }).click();
  await page.getByLabel('Selected month').fill('2023-02');
  await page.getByRole('button', { name: 'Create budget', exact: true }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('food');
  await page.getByRole('group', { name: 'Additional categories (optional)' }).getByLabel('Shopping', { exact: true }).check();
  await page.getByLabel('Budget period').selectOption('range');
  await page.getByLabel('Start date', { exact: true }).fill('2023-01-31');
  await page.getByLabel('End date', { exact: true }).fill('2023-02-06');
  await page.getByLabel('Spending limit (USD)').fill('100');
  await page.getByLabel('Count only selected posted transactions').check();
  await page.getByRole('checkbox', { name: /Historical groceries/ }).check();
  await page.getByRole('button', { name: 'Save budget', exact: true }).click();
  const budget = page.getByRole('button', { name: 'Edit Food & dining + Shopping budget', exact: true });
  await expect(budget).toContainText('2023-01-31 – 2023-02-06');
  await expect(budget.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '$10.00 spent of $100.00');
  await budget.click(); await page.getByRole('checkbox', { name: /Historical shopping/ }).check();
  await page.getByRole('button', { name: 'Save budget', exact: true }).click();
  await expect(budget.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '$30.00 spent of $100.00');
  await page.getByRole('link', { name: 'Goals', exact: true }).click();
  await page.getByRole('button', { name: 'Create goal', exact: true }).click();
  await page.getByLabel('Goal name').fill('Rainy day');
  await page.getByLabel('Target (USD)').fill('100');
  await page.getByLabel('Target date (optional)').fill('2024-01-01');
  await page.getByRole('checkbox', { name: /Historical salary/ }).check();
  await page.getByRole('button', { name: 'Save goal', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Rainy day progress' })).toHaveAttribute('aria-valuetext', '$50.00 of $100.00');
  await page.reload();
  await expect(page.getByRole('progressbar', { name: 'Rainy day progress' })).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: 'Create goal', exact: true }).click();
  await page.getByLabel('Goal name').fill('Trip spending');
  await page.getByLabel('Goal kind').selectOption('spending');
  await page.getByLabel('Target (USD)').fill('40');
  await page.getByRole('checkbox', { name: /Historical shopping/ }).check();
  await page.getByRole('button', { name: 'Save goal', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Trip spending progress' })).toHaveAttribute('aria-valuetext', '$20.00 of $40.00');
  await page.getByRole('button', { name: 'Edit goal Trip spending', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete goal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit goal Trip spending', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await page.getByLabel('Selected month').fill('2023-01');
  await page.getByRole('button', { name: 'Edit Historical salary, $50.00', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('link', { name: 'Goals', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Rainy day progress' })).toHaveAttribute('aria-valuetext', '$0.00 of $100.00');
});
