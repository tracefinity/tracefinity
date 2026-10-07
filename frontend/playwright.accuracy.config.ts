import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-accuracy',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  outputDir: 'test-results/accuracy',
  reporter: process.env.CI ? [['html', { outputFolder: 'playwright-report/accuracy' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4011',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'venv/bin/python -m uvicorn tests.e2e_accuracy_server:app --host 127.0.0.1 --port 8011',
      cwd: '../backend',
      url: 'http://127.0.0.1:8011/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm exec next dev --port 4011 --hostname 127.0.0.1',
      env: { BACKEND_URL: 'http://127.0.0.1:8011', NEXT_PUBLIC_API_URL: '' },
      url: 'http://127.0.0.1:4011',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
