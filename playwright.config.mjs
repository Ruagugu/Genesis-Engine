import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './qa',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:8123', viewport: { width: 1600, height: 900 } },
  webServer: { command: 'node qa/serve.mjs', port: 8123, reuseExistingServer: true }
});
