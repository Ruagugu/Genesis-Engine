import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './qa',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  // 各 spec 共享同一 API 服务与 local-seed run，并行 worker 会互相 reset 导致偶发失败
  workers: 1,
  use: { baseURL: 'http://localhost:8125', viewport: { width: 1600, height: 900 } },
  webServer: {
    command: 'node server/api.mjs',
    port: 8125,
    env: {
      PORT: '8125',
      GE_RUNS_DIR: '.qa-data/runs',
      GE_LLM_SETTINGS_PATH: '.qa-data/llm-settings.json',
      GE_USERS_PATH: '.qa-data/users.json'
    },
    reuseExistingServer: false
  }
});
