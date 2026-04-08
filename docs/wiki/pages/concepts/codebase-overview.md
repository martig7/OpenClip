---
type: concept
tags: [architecture, electron, obs-plugin, structure]
updated: 2026-04-08
sources: 1
---

# Codebase Overview

OpenClip is composed of two independently-built applications that communicate at runtime: an Electron desktop app and a native OBS Studio plugin. The Electron app drives the UI and business logic; the OBS plugin runs inside OBS to expose recording controls and scene management via HTTP.

## Key Points

- **Two-app architecture:** `electron-app/` (Electron + React + Node.js) and `obs-plugin/` (C plugin for OBS Studio). They are built and packaged separately but ship together in the NSIS installer.
- **Communication:** The Electron app reaches the OBS plugin through a local HTTP transport (`pluginHttpTransport.js`). It also communicates with OBS directly over WebSocket for some operations.
- **800-line file limit:** The project enforces a soft rule that no source file should exceed 800 lines. Files approaching this limit are candidates for extraction.
- **Backend modules** live in `electron-app/electron/`. Key ones:
  - `fileManager.js` — file organization, week-folder logic, move operations (950 lines — over limit)
  - `recordingService.js` — recording lifecycle, clip numbering, date-based counting (932 lines — over limit)
  - `gameWatcher.js` — process detection loop, hotkey registration, OBS start/stop triggers (424 lines)
  - `apiServer.js` — Express HTTP server exposing the local REST API consumed by the frontend viewer (574 lines)
  - `ipcHandlers.js` + `ipcHandlers/` subdirectory — IPC dispatch; refactored into per-domain handler files (`gameHandlers.js`, `obsHandlers.js`, `recordingHandlers.js`, `shareHandlers.js`, `watcherHandlers.js`, `windowHandlers.js`)
  - `obsPlugin.js` — manages the OBS plugin installation and detection
  - `obsIntegration.js` — high-level OBS control bridge
  - `obsEncoding.js` — re-encoding pipeline (H.264/H.265/AV1)
  - `store.js` — electron-store config wrapper
  - `winUtils.js` — Windows-specific utilities (655 lines)
  - `waveformCache.js`, `waveformPreCache.js`, `waveformUtils.js` — audio waveform generation and caching
  - `fileOperations.js` — lower-level file operation helpers (split from fileManager)
  - `migrations.js` — store schema migrations
  - `pluginHttpTransport.js` — HTTP client for talking to the OBS plugin
- **Frontend** lives in `electron-app/src/`. Key entry points:
  - `App.jsx` — root layout (vertical sidebar nav + main content area)
  - `pages/GamesPage.jsx` — game management UI (677 lines, near limit)
  - `pages/SettingsPage.jsx` — app settings
  - `viewer/` — the media viewer (Recordings, Clips, Storage pages)
  - `viewer/components/VideoPlayer.jsx` — video player with trim timeline (1207 lines — significantly over limit)
- **OBS plugin source** lives in `obs-plugin/src/`. Written in C. Key files: `http-server.c`, `scene-handlers.c`, `audio-handlers.c`. See `obs-plugin/README.md` for the full plugin API reference.
- **Tests** live in `electron-app/tests/`. Unit tests use Jest/Vitest; E2E tests use Playwright. Run the full suite with `npm run test` from `electron-app/` — do NOT use `npx vitest run` directly as it skips the Playwright E2E tests.
- **Testing stubs** (`*-testing.js` files in `electron-app/electron/`) are Jest module mapping stubs required for tests; they are not imported by production code.

## Files Over the 800-Line Limit (as of 2026-04-08)

| File | Lines |
|------|------:|
| `electron/fileManager.js` | 950 |
| `electron/recordingService.js` | 932 |
| `src/viewer/components/VideoPlayer.jsx` | 1207 |

## Related

- [[ipc-patterns]]
- [[fileManager]]
- [[gameWatcher]]
