---
type: concept
tags: [video, ffmpeg, pipeline, fileManager, recordingService, organize, clip, trim, reencode]
updated: 2026-04-08
sources: 0
---

# Video Processing Pipeline

The pipeline takes a raw OBS recording and transforms it through several stages: organize → clip creation → trim → re-encode. Each stage is handled by a combination of `fileManager.js` and `recordingService.js`, both using bundled ffmpeg/ffprobe binaries.

## Stage 1 — Organize (fileManager.js)

Triggered by the game watcher (8-second delay after session end) or manually via `organizeSpecificRecording`.

**Steps:**

1. `waitForStat` — retry `fs.statSync` up to 10× with 1s gaps; OBS briefly holds an exclusive handle on the file after stopping, causing EPERM
2. 2-second stabilization wait, then re-stat to confirm file size hasn't changed (OBS may still be flushing)
3. `waitForUnlock` — attempt `open(r+)` up to 5× with 2s gaps
4. Auto-clips pass (if enabled) — runs *before* the file is renamed or moved
5. Remux to MP4 if source is not already `.mp4`:
   - ffprobe probes audio stream titles first (MKV `title` tags are lost during MP4 container conversion; they go into a `.tracks.json` sidecar)
   - `ffmpeg -map 0 -c copy -movflags +faststart` — stream copy only, no re-encode
   - Source mtime is stamped onto the remuxed output so sort order reflects recording time, not remux time
   - Source delete is retried (`unlinkWithRetry`, 4 attempts × 750ms) because AV scanners may re-lock the new MP4
   - If ffmpeg itself fails, falls back to plain move (keeping original extension)
6. Plain move/rename if source is already MP4 or `organizeRemux` is disabled
7. Waveform pre-cache starts fire-and-forget after the file is placed

**Output naming:** `{GameName} Session {YYYY-MM-DD} #{N}.mp4`

`organizeSpecificRecording` (manual path) uses the file's **mtime** as the reference date, not the current date, so a recording made Monday that you organize on Thursday lands in Monday's week folder.

**OBS filename gate:** Files in the OBS recording folder are only treated as recordings if they match `OBS_FILENAME_PATTERN` (`YYYY-MM-DD HH-MM-SS`, `Replay YYYY-MM-DD …`, or `… Session YYYY-MM-DD #N`). This prevents unrelated videos the user may have placed in their OBS folder from being organized.

## Stage 2 — Auto-clips (fileManager.js → recordingService.js)

When auto-clip is enabled, `processAutoClipsFromFile` runs against the source before it is renamed.

**Marker-to-video-time mapping:**
Clip markers store an absolute Unix timestamp. The recording's start time is derived as `mtime - duration` (ffprobe determines duration). A marker is skipped silently if its position falls outside `[0, duration]`.

**Two sub-paths:**
- *No track selection* — direct ffmpeg `-map 0:v:0 -c copy` (muted output)
- *Track selection* — delegates to `createClip` (see Stage 3)

## Stage 3 — Manual clip creation (recordingService.js)

**Simple path** (no explicit audio track selection):
```
ffmpeg -ss {start} -i {src} -t {dur} -map 0 -c copy -avoid_negative_ts make_zero {out}
```
All streams are copied. Fast (seek before decode).

**Multi-step path** (explicit audio track selection — 3 ffmpeg passes):

1. **Base cut** — copy-cut the full time segment from source; this one read guarantees A/V is aligned for the subsequent passes
2. **Video strip** — copy video stream only from the base cut
3. **Audio build** — from the same base cut:
   - Single track: `asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0` → AAC 192k
   - Multi-track: same per-track fix, then `amix=inputs=N:normalize=0` to produce a mixed stream, plus individual streams
4. **Mux** — merge video temp + audio temp → final MP4 with `-movflags +faststart`

All three temp files are cleaned up in a `finally` block even if a step fails.

**Why three passes?** Re-reading the source twice for video+audio would risk A/V drift if the source has a non-zero start PTS. Using a single base-cut intermediate avoids that.

**Clip numbering:** `countClipsForDate` scans the clips directory for `{GameName} Clip {date} #N` to find the current maximum, then starts from `max + 1`. A while-loop fallback increments further if a file already exists at that number (race-safe for concurrent clip creation).

**Output:** `{GameName} Clip {YYYY-MM-DD} #{N}.mp4` inside `{destPath}/{GameName}/Clips/`

## Stage 4 — Trim (recordingService.js)

Trim is **two-phase** by design, because the Electron video element holds a read handle on the file it is currently playing.

1. `trimClip` — ffmpeg writes trimmed output to `{source}.tmp.mp4`; sets `trimState` to `ready`
2. Frontend receives the `ready` signal, clears its video `src`
3. `finalizeTrim` — renames `.tmp.mp4` over the original
   - Polls indefinitely on EPERM/EBUSY with 50ms gaps (no attempt cap — the OS *will* release the handle eventually)
   - Restores original mtime after rename so the clip doesn't jump to the top of same-day ordering

If `trimClip` fails, the temp file is deleted and `trimState` is set to `failed`. `finalizeTrim` will reject if called when state is not `ready`.

## Stage 5 — Re-encode (recordingService.js)

Supports h264 (`libx264`), h265 (`libx265`), av1 (`libsvtav1`). CRF is clamped to `[0, 51]`; preset is validated against the ffmpeg preset set.

**`replaceOriginal` atomic swap:**
1. Rename original → `{source}.bak`
   - Fails → abort; original is still intact
2. Rename temp encode → original path
   - Fails → restore `.bak` → original path; abort
3. Delete `.bak`

Any failure leaves the user's original file intact. The `.bak` file may linger if step 3 fails (logged but not re-attempted).

Timeout: 600 seconds (10 minutes) — necessary for large files or slow AV1 encodes.

## Auto-delete (recordingService.js)

Runs on watcher start. Two passes:

1. **Age pass** — mark files older than `max_age_days`
2. **Size pass** — if total bytes of un-age-deleted files still exceeds `max_storage_gb`, delete oldest first until under the limit

Clips are excluded by default (`exclude_clips: true`). Files in `lockedRecordings` store key are always skipped.

## Scan / cache layer (recordingService.js)

- Recordings and clips are scanned from disk and cached for 5 seconds (TTL cache).
- Files currently being remuxed are tracked in `activeRemuxPaths` (a `Set` of lowercase normalized paths) and hidden from scans — both source and destination paths are marked, preventing duplicate entries while ffmpeg is running.
- Cache is invalidated immediately on any mutation (clip create/delete, trim finalize, re-encode).

## Related

- [[fileManager]]
- [[recordingService]]
- [[waveform-pipeline]]
- [[edge-case-mkv-track-titles-lost]]
- [[edge-case-trim-two-phase]]
- [[edge-case-multi-track-clip-three-pass]]
- [[edge-case-reencode-atomic-swap]]
