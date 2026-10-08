import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1280, height: 720 },
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.ts --dev',
    url: 'http://127.0.0.1:3100',
    env: { PORT: '3100', HOST: '127.0.0.1' },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
