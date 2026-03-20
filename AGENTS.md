# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

OpenClip is a Windows Electron + React desktop app for automatic game recording with OBS Studio. The main code lives in `electron-app/`. The native OBS C plugin in `obs-plugin/` is optional and requires CMake + MSVC to build.

### Development commands

All commands run from `electron-app/`:

- **Install deps:** `npm install`
- **Dev server (frontend only):** `npx vite` (serves React at http://localhost:5173)
- **Dev server (full Electron):** `npm run dev` (requires a display; launches Vite + Electron)
- **Lint:** `npm run lint`
- **Unit tests:** `npm run test:unit` or `npx vitest run`
- **E2E tests:** `npm run test:e2e` (Playwright; needs `npx playwright install chromium` first)
- **Full test suite:** `npm run test` (includes vitest + Playwright + integration tests)
- **Build:** `npm run build` (Vite production build to `dist/`)

### Linux / Cloud VM caveats

- **koffi FFI failures are expected on Linux.** The `electron/winUtils.js` module loads Windows DLLs via koffi at import time. Tests that transitively import it (all `tests/api/*` suites, plus `fileManager.*` and `moveFileSafe` unit tests) will fail on Linux with "Failed to load shared library". This is not a code bug — those tests only pass on Windows.
- **Electron cannot launch headless on this VM** (no display + Windows-only features). Use `npx vite` alone for frontend dev, or run Playwright E2E tests which start their own Chromium.
- The Playwright E2E tests use mocked data and route interception, so they work fully on Linux without OBS or Electron.
- **Passing test scope on Linux:** 41 vitest suites pass (385 tests), 110 Playwright E2E tests pass. The 12 failing vitest suites (47 tests) all fail due to the koffi/Windows dependency, not code bugs.
