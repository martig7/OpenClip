/**
 * Playwright route mocks for API endpoints.
 *
 * RecordingsPage, ClipsPage, and StoragePage fetch from /api/* via apiFetch(),
 * which Vite proxies to the Electron API server. In tests we intercept these
 * requests at the browser level so no real server is required.
 *
 * IMPORTANT: Playwright processes routes in LIFO (reverse registration) order.
 * Register specific routes only — no catch-all — so they always run first.
 *
 * Usage:
 *   import { setupApiRoutes } from './fixtures/routes.js';
 *   test('...', async ({ page }) => {
 *     await setupApiRoutes(page);
 *     await page.goto('/#/recordings');
 *     ...
 *   });
 */

import { testRecordings, testClips, testStorageStats, testStorageSettings } from './testData.js';

function jsonResponse(data) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(data),
  };
}

export async function setupApiRoutes(page) {
  await page.route('**/api/recordings', route => route.fulfill(jsonResponse(testRecordings)));
  await page.route('**/api/clips', route => route.fulfill(jsonResponse(testClips)));
  await page.route('**/api/storage/stats', route => route.fulfill(jsonResponse(testStorageStats)));
  await page.route('**/api/storage/settings', route => route.fulfill(jsonResponse(testStorageSettings)));
}
