/**
 * Playwright fixture that launches the real Electron app in --test-mode and
 * provides its renderer window as the `page` fixture.  Tests import `test` and
 * `expect` from this file instead of directly from `@playwright/test`.
 *
 * One Electron process is shared per worker (scope: 'worker').  Between tests
 * the in-memory store is reset and any cached session-progress state is cleared
 * so every test starts from a known baseline.
 */
import { test as base, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Resolve to the electron-app root (three directories up from tests/e2e/fixtures/)
const ELECTRON_APP_DIR = resolve(__dirname, '..', '..', '..')

/** Poll until the renderer window with window.api is visible, then return it. */
async function findAppWindow(electronApp) {
  for (let i = 0; i < 80; i++) {
    const windows = electronApp.windows()
    for (const w of windows) {
      try {
        const hasApi = await w.evaluate(() => typeof window.api === 'object')
        if (hasApi) return w
      } catch {
        // Window not ready yet (DevTools or still loading).
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Could not find Electron renderer window with window.api')
}

export const test = base.extend({
  // One Electron instance per worker — launched once, reused across all tests
  // in that worker.  Each test gets a clean store via the `page` fixture below.
  electronApp: [
    async ({}, use) => {
      const app = await electron.launch({
        args: ['.', '--dev', '--test-mode'],
        cwd: ELECTRON_APP_DIR,
      })
      // Wait for the renderer to be ready before handing the app to tests.
      await findAppWindow(app)
      await use(app)
      await app.close()
    },
    { scope: 'worker' },
  ],

  // Per-test: reset store + session-progress state so tests are fully isolated.
  page: async ({ electronApp }, use) => {
    const page = electronApp.windows()[0]
    await page.evaluate(async () => {
      await window.api.resetStore()
      window.api.clearSessionProgress()
    })
    await use(page)
  },
})

export { expect }
