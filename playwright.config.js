import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.pw\.js/,
  fullyParallel: false,
  retries: 0,
  use: {
    headless: true,
  },
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
