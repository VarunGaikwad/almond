import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3100', viewport: { width: 1440, height: 1050 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: { command: 'npm run start -- --port 3100', url: 'http://127.0.0.1:3100', reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
