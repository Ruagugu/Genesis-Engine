import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './qa',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:8125', viewport: { width: 1600, height: 900 } },
  webServer: {
    command: 'node server/api.mjs',
    port: 8125,
    env: { PORT: '8125' },
    reuseExistingServer: false
  }
});
