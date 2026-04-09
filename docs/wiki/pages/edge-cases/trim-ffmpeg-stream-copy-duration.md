---
type: edge-case
tags: [recordingService, ffmpeg, trim, mp4, duration, movflags, stream-copy]
updated: 2026-04-08
sources: 0
---

# Edge Case: Trim Appears Unchanged — FFmpeg Stream-Copy Writes Wrong MP4 Duration

**Trigger:** Trim succeeds on the backend (file is renamed, size is smaller) but the UI shows the original duration after reload.

**Symptom:** After trim, `handleLoadedMetadata` reports the pre-trim duration (e.g. 60.928s) even though `fetchClips` returns the refreshed clip with a smaller `size_bytes`. The timeline appears unchanged. The media data *is* actually trimmed — if the video plays past the real end it simply stops — but the container header still advertises the old length.

**Root Cause:**

FFmpeg, when doing a stream-copy (`-c copy`) with input seeking (`-ss` before `-i`), may carry the source container's original `mvhd.duration` value into the output rather than computing it from the actual output samples. This happens because the moov atom is written early (as a placeholder) before all samples are known. The duration field in that placeholder reflects the source file's duration.

The symptom is the combination of: correct media data in mdat + wrong `mvhd.duration` / `tkhd.duration` fields in the moov atom. Players that trust the container header (like Chromium's `<video>`) report the wrong duration.

**Fix:** Add `-movflags +faststart` to the FFmpeg trim command:

```
ffmpeg -y -ss <start> -i <source> -t <dur> -c copy -avoid_negative_ts make_zero -movflags +faststart <output>
```

With `+faststart`, FFmpeg writes all the media data first (mdat), then writes the moov atom last — at which point the exact output duration is known from the actual samples — and finally moves moov to the front of the file. Because moov is computed *after* all samples are written, the duration fields are always correct.

**Side effect:** `+faststart` slightly increases FFmpeg's working time (requires a second pass over the moov to move it). For clips up to a few GB this is negligible; the rename step that follows takes longer anyway (EPERM retries on Windows).

**Detection:** Compare `refreshedClip.size_bytes` (smaller than original) against `videoDuration` from `handleLoadedMetadata`. If size decreased but duration is unchanged, this is the bug.

## Related

- [[recordingService]]
- [[frontend-clip-trim-flow]]
- [[edge-case-trim-two-phase]]
