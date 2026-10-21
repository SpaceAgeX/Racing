import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: './tests/browser',
  globalSetup: './tests/browser/global-setup.ts',
  globalTeardown: './tests/browser/global-teardown.ts',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    storageState: 'test-results/auth-state.json',
    viewport: { width: 1280, height: 720 },
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node --env-file=.env.local server/index.ts --dev',
    url: 'http://127.0.0.1:3100',
    env: { PORT: '3100', HOST: '127.0.0.1', MAX_BROWSER_SESSIONS: '0', RACING_RECORDINGS_DIR: resolve('test-results', 'recordings'), TRACKS_FILE: resolve('test-results', `tracks-${randomUUID()}.json`) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
