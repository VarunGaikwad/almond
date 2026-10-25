import { test, expect } from '@playwright/test';
import { mockCloud } from './auth-fixture';
import { localDate } from '../../src/lib/finance';

test.beforeEach(async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your money, in balance.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit .*\$/ }).first()).toBeVisible();
});

test('dashboard visibility persists without hiding Reports; accent and reset persist', async ({ page }) => {
  const balance = await page.locator('.hero-number').innerText();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  for (const name of ['Cashflow', 'Category spending', 'Recent transactions', 'Budget preview']) {
    const checkbox = page.getByRole('checkbox', { name, exact: true });
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
  }
  await page.getByRole('button', { name: 'Blue', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.hero-number')).toHaveText(balance);
  await expect(page.locator('.chart-grid')).toHaveCount(0);
  await expect(page.locator('.detail-grid')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.hero-number')).toHaveText(balance);
  await expect(page.locator('.chart-grid')).toHaveCount(0);
  await expect(page.locator('.detail-grid')).toHaveCount(0);
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.locator('.chart-grid')).toBeVisible();
  await expect(page.locator('.chart-grid > *')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Your month, at a glance' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Plum', exact: true }).click();
  await page.getByRole('switch', { name: 'Dark mode', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'plum');
  await page.getByRole('button', { name: 'Reset dashboard defaults' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'sage');
  for (const name of ['Cashflow', 'Category spending', 'Recent transactions', 'Budget preview']) await expect(page.getByRole('checkbox', { name, exact: true })).toBeChecked();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.chart-grid > *')).toHaveCount(2);
  await expect(page.locator('.detail-grid > *')).toHaveCount(2);
});

test('CSV previews before confirmation, appends one record, and excludes repeat duplicates', async ({ page }) => {
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  const initial = await page.locator('.transaction-row').count();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const file = { name: 'almond.csv', mimeType: 'text/csv', buffer: Buffer.from(`date,title,type,amount,account,category,notes\n${localDate()},CSV browser coffee,expense,12.34,checking,food,Manual import`) };
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('CSV file').setInputFiles(file);
  await expect(dialog.getByRole('status')).toContainText('1 valid, 0 invalid, 0 duplicate. 1 selected.');
  await expect(dialog.getByRole('region', { name: 'CSV preview', exact: true })).toContainText('CSV browser coffee');
  await expect(dialog.getByRole('button', { name: 'Import 1 transactions', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /I reviewed the preview/ }).check();
  await dialog.getByRole('button', { name: 'Import 1 transactions', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await expect(page.locator('.transaction-row')).toHaveCount(initial + 1);
  await expect(page.getByRole('button', { name: 'Edit CSV browser coffee, $12.34', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.transaction-row')).toHaveCount(initial + 1);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await dialog.getByLabel('CSV file').setInputFiles(file);
  await expect(dialog.getByRole('status')).toContainText('0 valid, 0 invalid, 1 duplicate. 0 selected.');
  await expect(dialog.getByText('Duplicate — excluded', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import 0 transactions', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await expect(page.locator('.transaction-row')).toHaveCount(initial + 1);
});
