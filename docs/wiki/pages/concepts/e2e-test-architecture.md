---
type: concept
tags: [testing, e2e, playwright, mock-api, electron]
updated: 2026-04-08
sources: 0
---

# E2E Test Architecture

OpenClip's end-to-end tests use Playwright running against a plain Chromium browser, not the Electron renderer. This means `window.api` (injected by Electron's preload via contextBridge) is never available in test runs, so two separate mock strategies are used depending on how each page fetches data.

## Key Points

### Two distinct mock layers

**`window.api` pages (GamesPage, SettingsPage)**

These pages call `window.api.*` directly. In the test browser there is no preload, so `src/api.js` automatically falls back to `mockApi`, which returns `mockGames` (Valorant, CS2) and `defaultSettings` (F9 hotkey, all toggles off) from `src/mockData.js`. No test setup is required for these pages — the mock data is deterministic and always present.

**`apiFetch` pages (RecordingsPage, ClipsPage, StoragePage)**

These pages call `apiFetch('/api/...')`, which normally proxies to the Electron-side HTTP API server. In tests, these requests are intercepted at the network layer using Playwright's `page.route()`. The helper `setupApiRoutes(page)` from `fixtures/routes.js` must be called **before** `page.goto()`.

`setupApiRoutes` registers the following intercepts:

| Route | Mock response |
|-------|--------------|
| `GET /api/recordings` | `testRecordings` (Valorant + CS2 recordings) |
| `GET /api/clips` | `testClips` (one Valorant clip) |
| `GET /api/storage/stats` | `testStorageStats` (4.43 GB total, 2 rec, 1 clip) |
| `GET /api/storage/settings` | `testStorageSettings` (auto-delete off) |
| `POST /api/**` | `{ success: true }` catch-all for mutations |

### Test mode flag

`npm run dev:test` starts Electron with `--test-mode`, which gives the Electron process an in-memory store (empty by default). Playwright's Chromium is unaffected by this — it still uses `mockApi` and `page.route()` mocks, not the Electron store.

### File layout

```
tests/e2e/
├── navigation.spec.js      — navigation and page loading
├── games.spec.js           — Games page: mock rendering, toggle, delete, add modal
├── settings.spec.js        — Settings page: hotkey, toggles, dirty-state save button
├── pages.spec.js           — Recordings/Clips/Storage/Settings data rendering
├── interactions.spec.js    — cross-page user interaction flows
└── fixtures/
    ├── testData.js         — shared mock data for both window.api and route responses
    └── routes.js           — setupApiRoutes(page) helper
```

### Running

```bash
# From electron-app/
npm run test:e2e          # headless
npm run test:e2e:ui       # Playwright UI mode

# Prerequisite (one-time)
npx playwright install chromium
```

Do not run `npx vitest run` directly — use `npm run test` from `electron-app/` to include Playwright tests alongside unit tests.

## Related

- [[plugin-integration-harness]]
