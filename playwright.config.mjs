import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './qa',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:8124', viewport: { width: 1600, height: 900 } },
  webServer: {
    command: 'node server/api.mjs',
    port: 8124,
    env: { PORT: '8124' },
    reuseExistingServer: false
  }
});
