import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for integration tests.
 *
 * These tests run against a REAL OBS instance (headless, self-contained) and
 * the real Electron API server with a real filesystem — no mocks.
 *
 * Everything is isolated from the developer's real install:
 *   - OBS uses --headless --portable with an isolated temp config directory
 *   - OBS recordings go to a temp folder, not ~/Videos/OBS
 *   - OpenClip uses 'open-clip-integration' userData, not 'open-clip'
 *   - OpenClip's destination folder is a separate temp directory
 *
 * Prerequisites:
 *   - OBS Studio 28+ installed, or the repo-local install at obs-studio/bin/64bit/obs64.exe
 *     (downloaded by the CI workflow; set OBS_BINARY env var to override the path)
 *
 * Run:
 *   npm run test:e2e:integration
 *
 * The globalSetup starts OBS automatically — no Docker, no manual pre-steps.
 */
export default defineConfig({
  testDir: './tests/e2e/integration',
  // Exclude the helpers directory — those are modules, not test files
  testIgnore: ['**/helpers/**'],
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
  // globalSetup runs first: starts OBS, creates temp dirs, sets env vars.
  // The returned function is called after all tests as the teardown.
  globalSetup: './tests/e2e/integration/global-setup.js',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Electron reads OBS_HOST/OBS_PORT/OBS_RECORDING_PATH/OPENCLIP_DEST_PATH
    // from env (set by globalSetup above) and seeds the isolated store.
    command: 'npm run dev:integration',
    url: 'http://localhost:5173',
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
});
