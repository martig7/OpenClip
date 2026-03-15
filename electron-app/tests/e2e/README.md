# E2E Tests

This directory contains Playwright end-to-end tests for the OpenClip Electron app.

## Prerequisites

1. Install Playwright browsers:
   ```bash
   npx playwright install chromium
   ```

## Running Tests

### Run all E2E tests:
```bash
npm run test:e2e
```

### Run tests with UI:
```bash
npm run test:e2e:ui
```

## How Mock Data Works

Playwright runs its own Chromium browser, **not** Electron's renderer. This means:

### Pages that use `window.api` (GamesPage, SettingsPage)
`window.api` is not injected by Electron's preload in Playwright's browser, so the app
falls back to `mockApi` in `src/api.js`. This returns `mockGames` (Valorant, CS2) and
`defaultSettings` (F9 hotkey, toggles off) from `src/mockData.js`.

No special setup needed — these pages already have deterministic mock data.

### Pages that use `apiFetch` (RecordingsPage, ClipsPage, StoragePage)
These pages call `apiFetch('/api/...')` which would normally proxy to the Electron API
server. In tests we intercept these requests using Playwright's `page.route()` before
they hit the network.

Call `setupApiRoutes(page)` from `fixtures/routes.js` **before** `page.goto()`:

```js
import { setupApiRoutes } from './fixtures/routes.js';

test('shows recordings', async ({ page }) => {
  await setupApiRoutes(page);
  await page.goto('/#/recordings');
  await expect(page.locator('.item-name:has-text("Valorant_2024-01-15_20-30-45.mp4")')).toBeVisible();
});
```

`setupApiRoutes` mocks:
- `GET /api/recordings` → `testRecordings` (Valorant + CS2 recordings)
- `GET /api/clips` → `testClips` (one Valorant clip)
- `GET /api/storage/stats` → `testStorageStats` (4.43 GB total, 2 rec, 1 clip)
- `GET /api/storage/settings` → `testStorageSettings` (auto-delete off)
- `POST /api/**` → `{ success: true }` (catch-all for mutations)

## Test Structure

- `navigation.spec.js` — Navigation and page loading tests
- `games.spec.js` — Games page: mock data rendering, toggle, delete dialog, add modal
- `settings.spec.js` — Settings page: hotkey, toggles, dirty-state save button
- `pages.spec.js` — Recordings, Clips, Storage, Encoding: data rendering tests
- `interactions.spec.js` — Cross-page user interaction flows
- `fixtures/testData.js` — Mock data for both `window.api` and API route responses
- `fixtures/routes.js` — `setupApiRoutes(page)` helper using `page.route()`

## Test Mode

When `dev:test` starts Electron (`--test-mode`), the Electron process runs with an
in-memory store (empty by default). Playwright's Chromium does not use this store
because it has no Electron preload — it uses `mockApi` instead for `window.api` calls,
and `page.route()` mocks for REST API calls.
