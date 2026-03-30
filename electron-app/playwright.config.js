import { defineConfig } from '@playwright/test'

/**
 * E2E config — uses Playwright's experimental Electron support.
 *
 * Tests import `test` and `expect` from `./tests/e2e/fixtures/electronPage.js`
 * which launches the real Electron app in `--test-mode` and provides the
 * renderer window as the `page` fixture.  No browser project is needed.
 *
 * The Vite dev server is started here so the Electron renderer can load
 * `http://localhost:5173` (Electron is launched with `--dev`).
 */
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/integration/**'],
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx vite',
    url: 'http://localhost:5173',
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
})
