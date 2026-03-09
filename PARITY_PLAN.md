# Electron App ↔ Python App Parity Plan

Tracking feature parity between `recordings_viewer.pyw` / `game_manager.pyw` / `game_watcher.pyw` and the Electron app.

---

## Critical (Broken behavior)

### ✅ 1. Auto-clip timestamp calculation is wrong
**File:** `electron-app/electron/fileManager.js`
**Problem:** `marker.timestamp` is a Unix epoch second, not a video position. The code uses it directly as an FFmpeg `-ss` seek offset, producing wildly incorrect clip start times.
**Fix:** Compute `videoPosition = marker.timestamp - (file.mtime - duration)`, then seek to `Math.max(0, videoPosition - bufferBefore)`. Also add `-avoid_negative_ts make_zero`.
**Status:** ✅ Fixed

### ✅ 2. Remux doesn't preserve all OBS audio tracks
**File:** `electron-app/electron/fileManager.js`
**Problem:** Remux command is `ffmpeg -i src -c copy dest` — missing `-map 0`. OBS records up to 6 audio tracks; only the first stream is kept without this flag.
**Fix:** Use `ffmpeg -i src -map 0 -c copy -movflags +faststart dest`.
**Status:** ✅ Fixed

---

## High (Missing features)

### ✅ 3. Encoding tab is entirely absent
**File:** New — `electron-app/src/pages/EncodingPage.jsx` + IPC handlers in `main.js`
**Problem:** Python `game_manager.pyw` has a full Encoding tab that reads/writes OBS encoder settings (`basic.ini` + `recordEncoder.json`). No equivalent exists in Electron.
**Fix:** Added `obsEncoding.js` backend module + IPC handlers (`obs:profiles`, `obs:encoding:get/set`, `obs:running`) + `EncodingPage.jsx` + nav/route in `App.jsx`.
**Status:** ✅ Fixed

### ✅ 4. Audio track selection not wired up in viewer UI
**Files:** `electron-app/electron/apiServer.js`, `electron-app/electron/recordingService.js`
**Problem:** The UI (`VideoPlayer`, `ClipControls`, `StoragePage`) was already sending `audio_tracks` correctly. The backend was stripping it — `apiServer.js` didn't pass it to the service, and `recordingService.js` had no `-map` flag logic.
**Fix:** Passed `audio_tracks` through `apiServer.js` → `recordingService.js` for both `/api/clips/create` and `/api/reencode`. Added `buildAudioMapArgs()` helper that generates `-map 0:v:0 -map 0:a:N ...` flags when a subset of tracks is selected.
**Status:** ✅ Fixed

### 🚫 5. Hotkey only fires during active recording
**File:** `electron-app/electron/main.js`
**Problem:** `registerHotkey()` guards on `currentGame` — pressing the clip marker key outside a game session is silently ignored.
**Decision:** Intentional — marking moments outside a recording session is not useful in the Electron workflow.
**Status:** 🚫 Won't fix

### ✅ 6. Auto-delete is configured but never runs
**Files:** `electron-app/electron/recordingService.js`, `electron-app/electron/main.js`
**Problem:** Both apps stored `storage_settings` but neither executed the purge.
**Fix:** Added `runAutoDelete()` to `recordingService.js`. Two passes: (1) age-based — delete anything older than `max_age_days`; (2) size-based — delete oldest first until under `max_storage_gb`. Locked recordings are always skipped. Called on `watcher:start` in `main.js`.
**Status:** ✅ Fixed

---

## Medium (Behavioral differences)

### ✅ 7. Single-instance watcher not enforced
**File:** `electron-app/electron/main.js`
**Problem:** The `if (watcher) return` guard in the IPC handler handles the IPC path, but `setupGameWatcher` has no internal guard.
**Status:** ✅ Already guarded via `if (watcher) return { running: true }` in IPC handler — acceptable.

### ✅ 8. Watcher polling interval is 2× slower
**File:** `electron-app/electron/gameWatcher.js`
**Problem:** Electron polls every 2 seconds; Python polls every 1 second.
**Fix:** Change `setTimeout(poll, 2000)` → `setTimeout(poll, 1000)`.
**Status:** ✅ Fixed

### ✅ 9. Recording organization delay mismatch
**File:** `electron-app/electron/fileManager.js`
**Problem:** Python waits 2 seconds after game stop before organizing; Electron waits 3 seconds.
**Fix:** Change organize `setTimeout` delay from 3000 → 2000.
**Status:** ✅ Fixed

---

## Low (Polish / completeness)

### ✅ 10. Game icons not displayed
**File:** `electron-app/src/pages/GamesPage.jsx`
**Problem:** `games_config.json` has an `icon` field written by the Python app; Electron ignores it.
**Fix:** Render a 24×24 `<img>` with a `file:///` URL before the game name. Hidden via `onError` if the path is missing or broken.
**Status:** ✅ Fixed

### ✅ 11. No watcher log file
**File:** `electron-app/electron/gameWatcher.js`, `electron-app/electron/constants.js`
**Problem:** Python watcher writes to `runtime/watcher.log`; Electron has no equivalent.
**Fix:** Added `LOG_FILE` constant and `log()` helper. Log is cleared on watcher start (matching Python). Events logged: start, game detected, game stopped, watcher stopped.
**Status:** ✅ Fixed

### ✅ 12. PID file not written
**File:** `electron-app/electron/gameWatcher.js`, `electron-app/electron/constants.js`
**Problem:** Python writes `runtime/watcher.pid` for single-instance checking. Electron doesn't.
**Fix:** Added `PID_FILE` constant. `process.pid` written on watcher start, deleted on stop.
**Status:** ✅ Fixed

---

## Completed (Pre-existing fixes)

### ✅ OBS path double-backslash corruption
`electron.json` stored `C:\\\\Users\\...` (double-escaped). Added `normalizePath()` to all path read/write paths in `main.js` and corrected the stored value.

### ✅ Unorganized recordings show all videos in folder
`recordingService.js` listed every video in the OBS folder. Added OBS filename pattern filter (matching `recordings_viewer.pyw`) to exclude unrelated files.
