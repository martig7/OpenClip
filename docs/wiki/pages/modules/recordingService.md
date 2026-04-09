---
type: module
tags: [recordingService, ffmpeg, clip, trim, reencode, scan, auto-delete]
updated: 2026-04-08
sources: 0
---

# recordingService

**File:** `electron-app/electron/recordingService.js`
**Responsibility:** All FFmpeg operations (clip, trim, re-encode) and file scanning/caching. Both `fileManager.js` and `apiServer.js` delegate here.

## Key Functions

- `createClip(sourcePath, startTime, endTime, gameName, audioTracks)` — cuts a clip; takes two FFmpeg code paths depending on whether `audioTracks` is provided (see [[video-processing-pipeline]])
- `trimClip(sourcePath, startTime, endTime)` — phase 1 of trim; writes `.tmp.mp4`, sets `trimState` to `ready`
- `finalizeTrim(sourcePath)` — phase 2 of trim; renames temp over original, polls indefinitely on EPERM
- `reencodeVideo(sourcePath, opts)` — full re-encode to h264/h265/av1; atomic `.bak` swap when `replaceOriginal: true`
- `scanRecordings()` — reads organized folder + OBS path; understands both old (`GameName - Week of …`) and new (`GameName/Week of …`) folder formats
- `scanClips()` — reads legacy `{org}/Clips/` and new `{org}/{GameName}/Clips/`
- `countClipsForDate(clipsPath, gameName, dateStr)` — scans for highest clip `#N` on a given date; result is cached and cleared on any clip mutation
- `runAutoDelete()` — age-based pass then size-based pass; respects `lockedRecordings`
- `markRemuxing(src, dest)` / `unmarkRemuxing(src, dest)` — adds/removes paths from `activeRemuxPaths` to hide them from scans during remux
- `killAllProcesses()` — SIGTERM + 3s SIGKILL for all tracked FFmpeg children; partial output files are deleted

## Known Quirks

- **`trimState` map** — persists in memory per process. If the main process restarts between `trimClip` and `finalizeTrim`, the state is lost and `finalizeTrim` will throw. The `.tmp.mp4` orphan must be cleaned up manually.
- **Multi-track clip produces individual + mixed audio streams** — the mux step maps `1:a` (all streams from the audio temp), so the output MP4 contains both a mixed track and individual per-track streams.
- **`avoid_negative_ts make_zero`** — used on all copy-cut operations to prevent playback issues in players that don't handle negative DTS.
- **`-movflags +faststart` on trim** — required so that FFmpeg computes the moov atom from actual output samples rather than copying the source container's duration. Without it, stream-copy trims can produce an MP4 whose `mvhd.duration` still reflects the pre-trim length even though the media data is correctly shortened. See [[edge-case-trim-ffmpeg-stream-copy-duration]].
- **5-second scan cache** — `scanRecordings()` and `scanClips()` return stale data for up to 5 seconds after an external change (e.g., a file moved from outside the app). Mutations via the app invalidate immediately.
- **`activeFFmpeg` map** — tracks all running FFmpeg child processes so `killAllProcesses()` (called on app quit) can clean them up and delete their partial output files.

## Related

- [[video-processing-pipeline]]
- [[fileManager]]
- [[waveform-pipeline]]
