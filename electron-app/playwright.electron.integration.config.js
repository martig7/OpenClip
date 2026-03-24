import { defineConfig } from '@playwright/test'

/**
 * Electron full-stack integration config.
 *
 * Runs the real Electron app via Playwright's experimental Electron support
 * (`_electron.launch`) while Vite serves the renderer in dev mode.
 */
export default defineConfig({
  testDir: './tests/e2e/integration',
  testMatch: ['**/electron-full-stack.spec.js'],
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['html', { outputFolder: 'playwright-report-electron-integration' }]],
  globalSetup: './tests/e2e/integration/global-setup.js',
  webServer: {
    command: 'npx vite',
    url: 'http://localhost:5173',
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
})
