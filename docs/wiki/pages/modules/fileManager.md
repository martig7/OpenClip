---
type: module
tags: [fileManager, organize, remux, autoClip, markers, weekFolders, waveform]
updated: 2026-04-08
sources: 0
---

# fileManager

**File:** `electron-app/electron/fileManager.js`
**Responsibility:** Orchestrates the organize flow — waiting for OBS to release files, auto-clipping from markers, remuxing to MP4, moving to the destination folder, and triggering waveform pre-cache.

## Key Functions

- `organizeRecordings(store, gameName, onProgress)` — triggered by the game watcher; processes new recordings from the OBS path
- `finalizeDirectRecording(store, gameName, recordingDir, onProgress)` — same flow but for direct-recording mode (file already in game folder)
- `organizeSpecificRecording(store, filePath, gameName, opts)` — manual organize of a single file; uses file **mtime** (not current date) for week folder placement
- `reorganizeWeekFolders(store, onProgress)` — reshuffles existing organized recordings when the `weekFolders` setting is toggled
- `processAutoClipsFromFile(store, gameName, srcPath, srcStat, onProgress)` — converts clip markers to time-bounded clips before the source file is renamed

## Known Quirks

- **OBS file lock sequence matters** — the pipeline does `waitForStat` → 2s wait → re-stat size check → `waitForUnlock` in that order. Skipping any step risks reading a partially-written file or triggering EPERM on rename.
- **Auto-clips run before rename** — `processAutoClipsFromFile` reads the original source path. Once the file is renamed or remuxed, that path is gone. Clip creation must complete before `moveFileSafe` or `execFileAsync(ffmpeg …)`.
- **Remux failure fallback** — if ffmpeg exits with an error the partial output is deleted and the source is moved with its original extension (non-MP4). The session name is still applied.
- **Remux success + delete failure** — if ffmpeg succeeds but the source `unlink` fails (AV scanner re-locked it), the remuxed output is kept and the orphaned source is logged as a warning, not an error. Both files will appear in the next scan.
- **`deleteFullRecording` timing** — if the user has enabled auto-delete of the full recording after clipping, fileManager awaits the waveform pre-cache promise before deleting. This ensures the waveform is cached even though the source file will no longer exist.
- **Sanitized name length cap** — game names are truncated to 80 characters and stripped of `:/\?*|"<>` to be safe on Windows, macOS, and Linux.

## Related

- [[video-processing-pipeline]]
- [[recordingService]]
- [[waveform-pipeline]]
- [[edge-case-mkv-track-titles-lost]]
