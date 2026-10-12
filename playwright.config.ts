import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:8710', trace: 'off' },
  webServer: { command: 'node tests/browser/serve.mjs', url: 'http://127.0.0.1:8710/tests/browser/fixtures/page.html', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, grep: /@touch/ },
    { name: 'mobile-webkit', use: { ...devices['iPhone 15'] }, grep: /@touch/ },
  ],
});
