import { defineConfig } from '@playwright/test';

// Deliberately no webServer, dotenv loading, browser fixtures, or artifact capture.
export default defineConfig({
  testDir: './tests/live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'line',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
