import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for integration tests (real headless OBS + OpenClip plugin + Electron API).
 *
 * Run: npm run test:e2e:integration
 * Prerequisites: OBS 28+ or repo-local obs-studio/bin/64bit/obs64.exe; set OBS_BINARY to override.
 */
export default defineConfig({
  testDir: './tests/e2e/integration',
  // Exclude the helpers directory — those are modules, not test files
  testIgnore: ['**/helpers/**', '**/electron-full-stack.spec.js'],
  timeout: 60000,
  // Sequential: tests share a single OBS instance
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report-integration' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  globalSetup: './tests/e2e/integration/global-setup.js',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev:integration',
    url: 'http://localhost:47531/api/recordings',
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
})
