# Electron App Optimization Plan

## Phase 1: Foundation (do first -- unblocks later work) [COMPLETED]

### 1. Shared Constants Module [DONE]
Created `electron/constants.js` with `VIDEO_EXTENSIONS`, `MIME_TYPES`, `CODEC_MAP`, `RUNTIME_DIR`, `STATE_FILE`, `MARKERS_FILE`, `formatFileSize()`, `isVideoFile()`. All consumers updated.

### 2. Unified Recording Service [DONE]
Created `electron/recordingService.js` with canonical `scanRecordings`, `scanClips`, `createClip`, `deleteFile`, `reencodeVideo`. Both `apiServer.js` and `fileManager.js` now delegate to it. Eliminated ~150 lines of duplicate code. Also added 1MB request body size limit to `apiServer.js`.

---

## Phase 2: Performance (biggest user-facing impact) [COMPLETED]

### 3. Async Game Watcher [DONE]
Replaced both `execSync` calls with async `exec` wrapped in Promises. Both `tasklist` and PowerShell now run in parallel via `Promise.all`. Changed from `setInterval` to `setTimeout` re-scheduling to prevent overlapping. Watcher now returns `{ stop() }` instead of `{ interval }`.

### 4. Filesystem Scan Caching [DONE]
Added 5-second TTL cache to `recordingService.js` for `scanRecordings()` and `scanClips()`. Cache automatically invalidated after `createClip`, `deleteFile`, and `reencodeVideo`. Exported `invalidateCache()` for external callers.

### 5. Async Remaining `execSync` Calls [DONE]
- `windows:list` IPC handler now uses async `exec`
- `/api/storage/stats` disk usage now uses async `getDiskUsage()` helper
- `/api/markers` `getVideoDuration()` now uses async `exec` for ffprobe

---

## Phase 3: Reliability [COMPLETED]

### 6. FFmpeg Process Cleanup [DONE]
Added `activeFFmpeg` Map in `recordingService.js` tracking spawned `exec` processes and their output paths. Both `createClip` and `reencodeVideo` register/deregister processes. `killAllProcesses()` kills all active processes and deletes their partial output files. Called from `app.on('window-all-closed')` in `main.js`.

### 7. Request Body Size Limit [DONE]
`readBody()` enforces a 1MB cap and returns 413 if exceeded. Already implemented.

### 8. Clip Markers Bounds [DONE]
Added `MAX_MARKERS = 1000` constant in `main.js`. `saveElectronMarkers()` now trims to the newest 1000 entries before writing.

### 9. Store Write Debouncing [WON'T FIX]
Window bounds already debounced via 500ms resize timer. All other writes (games, storageSettings, lockedRecordings, settings) are rare user-triggered actions — adding debounce complexity provides negligible benefit.

---

## Phase 4: Polish [COMPLETED]

### 10. Fix Duplicate Watcher Polling [DONE]
Removed the 2-second `setInterval` from `GamesPage.jsx`. Added `pushWatcherStatus()` in `main.js` that sends a `watcher:status-push` IPC event with full status (`running`, `currentGame`, `startedAt`, `gameState`). Called on watcher start, stop, and every game state change. `GamesPage` subscribes via `onWatcherStatusPush` and keeps one initial `loadWatcherStatus()` fetch.

### 11. Path Traversal Validation [DONE]
Added `isAllowedPath(filePath)` helper in `apiServer.js` that resolves the path and checks it falls within `obsRecordingPath` or `destinationPath`. Applied to `/api/video`, `/api/delete`, `/api/clips/delete`, `/api/reencode`, and `/api/video/tracks`. Returns 403 Forbidden for paths outside allowed roots.
