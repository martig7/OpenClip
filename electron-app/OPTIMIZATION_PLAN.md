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

## Phase 3: Reliability

### 6. FFmpeg Process Cleanup
Track spawned `ffmpeg` child processes in a `Set`. On `before-quit` / `window-all-closed`, kill them all and clean up partial output files. Currently orphaned on exit.

### 7. Request Body Size Limit
`readBody()` has no cap -- add a 1MB limit and return 413 if exceeded.

### 8. Clip Markers Bounds
`clipMarkers` array grows unbounded. Add a `MAX_MARKERS` cap (e.g., 1000) and trim oldest on overflow. Optionally auto-purge markers older than N days on startup.

### 9. Store Write Debouncing
`store.set()` calls `writeFileSync` synchronously every time. Debounce with a 100-200ms `setTimeout`, with an immediate flush on `before-quit`.

---

## Phase 4: Polish

### 10. Fix Duplicate Watcher Polling
`GamesPage.jsx` polls `watcher:status` every 2s AND subscribes to `watcher:state` IPC. Remove the polling; keep only the IPC subscription + one initial fetch on mount.

### 11. Path Traversal Validation
`/api/video`, `/api/delete`, `/api/reencode` accept arbitrary paths. Validate all paths resolve within `obsRecordingPath` or `destinationPath`. Important even for localhost.
