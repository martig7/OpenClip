---
type: module
tags: [obs-plugin, http-api, obs, c-plugin, recording]
updated: 2026-04-08
sources: 2
---

# OBS Plugin (`openclip-obs`)

**Files:** `obs-plugin/src/` (C source), `electron-app/electron/obsPlugin.js`, `electron-app/electron/pluginHttpTransport.js`
**Responsibility:** Native OBS Studio plugin that exposes a local HTTP JSON-RPC server so the Electron app can control recording, scenes, audio routing, and video settings without requiring OBS WebSocket.

## Overview

The plugin replaces an earlier Lua script + WebSocket approach. It binds an HTTP server to `127.0.0.1` on a dynamic port (written to a runtime port file) and exposes a single `POST /api` endpoint. The Electron app reads the port file and calls this endpoint. Health checks are available at `GET /` or `GET /health`.

The port is dynamic — the plugin writes the bound port to a file that `pluginHttpTransport.js` reads. The transport tries `127.0.0.1`, then `::1`, then `localhost` in sequence to handle IPv4/IPv6 stack differences. Port is cached for 3 seconds to reduce file reads.

## HTTP API

All requests use the same envelope:

```json
POST http://127.0.0.1:<port>/api
{ "method": "<methodName>", "params": { ... } }
```

Success response: `{ "success": true, "data": { ... } }`
Error response: `{ "success": false, "error": "..." }`

### Methods

| Method | Key Params | Notes |
|--------|-----------|-------|
| `getStatus` | — | Plugin version, OBS version, recording state |
| `startRecording` | `sceneName?` | Optionally switches scene before recording |
| `stopRecording` | — | Stops and restores previous scene |
| `getRecordingStatus` | — | Current recording state |
| `getScenes` | — | Array of all scene names |
| `createScene` | `sceneName` | Empty scene |
| `createSceneFromTemplate` | `sceneName`, `templateSceneName` | Copies sources from template |
| `createSceneFromScratch` | `sceneName`, `addWindowCapture?`, `windowTitle?`, `exe?`, `windowClass?`, `captureKind?`, `addDesktopAudio?`, `addMicAudio?` | Full scene setup in one call |
| `deleteScene` | `sceneName` | — |
| `switchScene` | `sceneName` | — |
| `getSceneItems` | `sceneName` | — |
| `duplicateSceneItem` | `fromScene`, `sceneItemId`, `toScene` | — |
| `addSource` | `sceneName`, `inputName`, `inputKind`, `inputSettings?`, `fitToCanvas?` | — |
| `removeSceneItem` | `sceneName`, `sceneItemId` | — |
| `setItemTransform` | `sceneName`, `sceneItemId`, `transform` | Position/bounds |
| `getAudioInputs` | — | All audio input sources |
| `getSceneAudioSources` | `sceneName` | Audio sources in a scene |
| `getInputAudioTracks` | `inputName` | Track routing object |
| `setInputAudioTracks` | `inputName`, `tracks` | `tracks` is `{"1": bool, "2": bool, ... "6": bool}` |
| `getTrackNames` | — | Array of 6 profile track name strings |
| `setTrackNames` | `names` | Set all 6 profile track names |
| `getVideoSettings` | — | Canvas resolution and FPS |

## Source Code Structure

```
http-server.c       (498 lines) — HTTP server, JSON parse, dispatches to api-handlers
api-handlers.c      (136 lines) — Method routing to handler modules
api-utils.c         (122 lines) — Shared JSON/OBS helpers
recording-handlers.c (69 lines) — start/stop/status
scene-handlers.c    (366 lines) — create/delete/switch/duplicate scenes
source-handlers.c   (173 lines) — add/remove/transform sources
audio-handlers.c    (194 lines) — audio routing and track names
video-handlers.c     (27 lines) — canvas resolution and FPS
plugin-main.c       (155 lines) — OBS plugin entry point, hooks
```

## Thread Safety

The HTTP server runs on a background thread. All OBS API calls must run on OBS's UI thread. `api_dispatch()` (in `api-handlers.c`) routes every request through `obs_queue_task()` before touching any OBS API. This is enforced at the dispatch layer — individual handlers do not manage thread switching themselves.

## Build Process

Requires: CMake 3.16+, MSVC 2019+ / GCC 11+ / Clang 14+, OBS Studio SDK 30.0+.

```powershell
# Windows
cmake -B build -S . -DOBS_DIR="C:\Program Files\obs-studio" -G "Visual Studio 17 2022"
cmake --build build --config Release
# Output: build/Release/openclip-obs.dll
```

The OpenClip setup wizard handles installation automatically; manual install is also possible (see [[obs-plugin-install]]).

## Electron-Side Transport (`pluginHttpTransport.js`)

- `resolvePluginPort(defaultPortFile)` — reads port from env var `OPENCLIP_PLUGIN_HTTP_PORT`, then env var `OPENCLIP_PLUGIN_PORT_FILE`, then the passed `defaultPortFile`. Caches result for 3 seconds.
- `callPluginHttp(port, method, params)` — tries `127.0.0.1`, `::1`, `localhost` in order; retries on connection-level errors (`ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, etc.); does not retry on plugin-level errors (`pluginHttpError` flag).
- `waitForPluginHttpReady(port, opts)` — polls `getStatus` until ready (default 60s timeout, 250ms interval). Used after OBS starts.
- `invalidatePluginPortCache()` — called on connection errors to force re-read of port file on next call.

Request timeout is 10 seconds (`REQUEST_TIMEOUT_MS`).

## Known Quirks

- **OBS update causes "plugin missing"**: After an in-place OBS update, the plugin may appear as "[PLUGIN NOT FOUND]" in the Plugin Manager. Root cause is that in-place updates skip the DLL directory registration step, so `obs.dll`/`obs-frontend-api.dll` can't be resolved. Reinstalling OBS (not just the plugin) fixes it. See also the `modules.json` stale entry issue documented in [[obs-plugin-install]].
- **Dynamic port, not hardcoded**: Earlier documentation may reference port `28756` as a fixed port. The plugin now writes its actual bound port to a runtime file. The hardcoded value in `README.md` examples (`28756`) reflects only the default or a common value, not a guarantee.
- **AppData vs ProgramData install paths**: The install path matters for whether OBS auto-discovers the plugin in `modules.json` — see [[obs-plugin-install]] for the full details.

## Related

- [[obs-plugin-install]]
