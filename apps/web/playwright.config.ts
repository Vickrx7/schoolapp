import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
// Use a pre-installed browser when the bundled one isn't available (e.g. sandboxes).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['./e2e/failure-context-reporter.ts'], ['html', { open: 'never' }]]
    : 'list',
  timeout: 60_000,
  use: {
    baseURL,
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
      testIgnore: /(mobile|tablet)\.spec\.ts/,
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], launchOptions: { executablePath } },
      testMatch: /mobile\.spec\.ts/,
    },
    {
      // Class devices (« Quiz sur les appareils », Phase 5). Only Chromium is installed here, so
      // this is Chrome on an Android tablet; Chromebooks are a 1366×768 viewport in the specs and
      // iPads are checked by hand.
      name: 'tablet',
      use: { ...devices['Galaxy Tab S4'], launchOptions: { executablePath } },
      testMatch: /tablet\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm start',
        url: `${baseURL}/login`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
