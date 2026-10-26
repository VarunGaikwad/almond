import { test, expect } from '@playwright/test';
import { mockCloud } from './auth-fixture';

test('empty schedules have inset text and paragraph spacing on desktop and mobile', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Schedules', exact: true }).click();
  const panel = page.locator('.schedule-list');
  await expect(panel.getByText('No schedules yet. Create a one-time or recurring payment.', { exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const spacing = await panel.evaluate(element => {
      const box = element.getBoundingClientRect();
      const [intro, empty] = Array.from(element.querySelectorAll(':scope > p')).map(p => p.getBoundingClientRect());
      return {
        top: intro.top - box.top,
        left: Math.min(intro.left, empty.left) - box.left,
        right: box.right - Math.max(intro.right, empty.right),
        bottom: box.bottom - empty.bottom,
        gap: empty.top - intro.bottom,
        fits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    for (const inset of [spacing.top, spacing.left, spacing.right, spacing.bottom, spacing.gap]) expect(inset).toBeGreaterThanOrEqual(16);
    expect(spacing.fits).toBe(true);
  }
});

test('plan, edit, explicitly record one occurrence, reload and delete without deleting ledger history', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your money, in balance.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit .*\$/ }).first()).toBeVisible();
  const balance = await page.locator('.hero-number').innerText();
  await page.getByRole('link', { name: 'Schedules', exact: true }).click();
  await page.getByRole('button', { name: 'Create schedule', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Planned rent');
  await page.getByLabel('Amount (USD)', { exact: true }).fill('25.00');
  await page.getByLabel('Frequency', { exact: true }).selectOption('monthly');
  await page.getByLabel('Next due date', { exact: true }).fill('2023-01-31');
  await page.getByLabel('End date (optional)', { exact: true }).fill('2023-03-31');
  await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.hero-number')).toHaveText(balance);
  await page.getByRole('link', { name: 'Schedules', exact: true }).click();
  await page.getByRole('button', { name: 'Edit schedule Planned rent', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Planned home');
  await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Record payment for Planned home on 2023-01-31', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record payment for Planned home on 2023-02-28', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Record payment for Planned home on 2023-02-28', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record payment for Planned home on 2023-02-28', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record payment for Planned home on 2023-03-31', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record payment for Planned home on 2023-03-31', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Completed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit schedule Planned home', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete schedule', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit schedule Planned home', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  await page.getByLabel('Selected month', { exact: true }).fill('2023-01');
  await expect(page.getByRole('button', { name: 'Edit Planned home, $25.00', exact: true })).toHaveCount(1);
});
