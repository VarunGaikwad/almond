import { test, expect } from '@playwright/test';
import { mockCloud } from './auth-fixture';

for (const theme of ['light', 'dark'] as const) {
  test(`defaults to the ${theme} system theme and preserves a manual override`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await mockCloud(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your money, in balance.' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const override = theme === 'dark' ? 'light' : 'dark';
    await page.getByRole('button', { name: `Switch to ${override} theme` }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', override);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your money, in balance.' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', override);
  });

  test(`login defaults to the ${theme} system theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await mockCloud(page, false);
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  });
}
