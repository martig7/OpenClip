# Trim Clip Feature — Design Spec

**Date:** 2026-03-26
**Status:** Approved

## Summary

Add a "Trim Clip" action to the clips page that lets users shorten an existing clip from either end. The trimmed result overwrites the original file in place. The feature reuses the existing clip creator UI (ZoomTimeline drag handles, info bar View 2 controls) by adding a single `isTrimMode` boolean to the existing `clipMode` flow.

---

## Entry Point

- "Trim Clip" is added as a menu item in the `...` dropdown on the clips page info bar (View 1 — title bar).
- It sits alongside existing items: Organize, Open in Player, Show in Explorer, Delete.
- The primary "Create Clip" button remains hidden for clips (as it is today).

---

## State Changes — VideoPlayer.jsx

| New state | Type | Purpose |
|---|---|---|
| `isTrimMode` | `boolean` | Distinguishes trim from create within `clipMode` |
| `isTrimming` | `boolean` | Loading guard while trim FFmpeg is running (analogous to `isCreatingClip`) |

- `enterTrimMode()`: sets `clipMode=true`, `isTrimMode=true`, `clipStart=0`, `clipEnd=duration`, calls `zoomFit()`.
- `exitClipMode()`: reset `isTrimMode=false` in addition to existing resets — Cancel works unchanged.
- No new drag handle, zoom, or timeline state needed.

---

## UI Changes — VideoPlayerInfoBar.jsx

**View 1 (title bar dropdown):**
- Add "Trim Clip" menu item (with Scissors icon) that calls `enterTrimMode`.

**View 2 (clip mode controls):**
- Action button label: `isTrimMode ? "Trim Clip" : "Create Clip"`
- Action button handler: `isTrimMode ? handleTrimClip : handleCreateClip`
- Everything else unchanged: zoom controls, start/end/duration display, Cancel button, `...` dropdown.

New props passed into `VideoPlayerInfoBar`: `isTrimMode`, `enterTrimMode`, `handleTrimClip`, `isTrimming`.

---

## Frontend Handler — VideoPlayer.jsx

`handleTrimClip()`:
1. Guards: `!media || isTrimming` → return early.
2. Sets `isTrimming=true`.
3. Posts `{ source_path: media.path, start_time: clipStart, end_time: clipEnd }` to `POST /api/clips/trim`.
4. On success: exits clip mode (`clipMode=false`, `isTrimMode=false`), calls `onTrimmed(updatedClip)`.
5. On error: `alert(...)` matching the existing `handleCreateClip` error pattern.
6. Finally: `isTrimming=false`.

New prop: `onTrimmed(updatedClip)` — analogous to `onClipCreated`.

---

## ClipsPage.jsx

- Passes `onTrimmed` to `VideoPlayer`:
  - Updates `selectedClip` with the returned clip metadata.
  - Calls `fetchClips()` to refresh the sidebar list.

---

## Backend — recordingService.js

New function: `trimClip(sourcePath, startTime, endTime)`

1. Validates: source exists, `endTime > startTime`.
2. Computes temp path: `<sourcePath>.tmp.mp4` (same directory).
3. Runs FFmpeg stream-copy cut (same args as `createClip` simple path):
   ```
   ffmpeg -y -ss <startTime> -i <sourcePath> -t <duration> -map 0 -c copy -avoid_negative_ts make_zero <tempPath>
   ```
4. On FFmpeg success: `fs.renameSync(tempPath, sourcePath)` to atomically replace.
5. On FFmpeg failure: clean up temp file, throw error.
6. Reads updated file stats (size), returns `{ path, filename, size_formatted, game_name, date }`.
7. Calls `invalidateClipsCache()`.
8. Exported alongside `createClip`.

---

## Backend — apiServer.js

New route: `POST /api/clips/trim`

- Reads `{ source_path, start_time, end_time }` from request body.
- Calls `service.trimClip(source_path, start_time, end_time)`.
- Returns result JSON or error (404 if not found, 400 if invalid times, 500 otherwise).
- Placed adjacent to `POST /api/clips/create`.

---

## Backend — apiServer-testing.js

New mock route: `POST /api/clips/trim`

- Returns a stub success response (same shape as the real endpoint).
- Consistent with other mock routes in that file.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| FFmpeg fails | Temp file cleaned up; original untouched; alert shown in UI |
| Source file missing | 404 from backend; alert shown in UI |
| `endTime <= startTime` | 400 from backend; alert shown in UI |
| Rename fails after cut | Temp file may be left; error propagated to UI |

---

## Out of Scope

- No progress indicator (trim is fast stream-copy, typically sub-second).
- No undo / backup of original.
- No audio track selection for trim (trims all tracks, same as the original clip).
