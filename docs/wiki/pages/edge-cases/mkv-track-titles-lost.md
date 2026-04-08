---
type: edge-case
tags: [fileManager, remux, mkv, mp4, audio, tracks]
updated: 2026-04-08
sources: 0
---

# Edge Case: MKV Audio Track Titles Lost During MP4 Remux

**Trigger:** OBS records to MKV and the recording is organized (remuxed to MP4).
**Symptom:** Audio track names (e.g., "Desktop", "Mic") visible in OBS are absent in the remuxed MP4 and can't be read back by the app.
**Root Cause:** The MKV `title` tag on audio streams is a Matroska-specific metadata field. When ffmpeg remuxes with `-c copy` into an MP4 container, stream metadata titles are not carried over — MP4 uses a different metadata structure (`handler_name`).
**Fix:** `organizeRecordings` and `organizeSpecificRecording` probe the source file with ffprobe *before* the remux call, extract `tags.title` / `tags.TITLE` from each audio stream, and write them to a sidecar file `{dest}.tracks.json`. The app reads this sidecar to label audio tracks.
**Prevention:** Any future remux or container conversion must re-probe and re-save `.tracks.json` if stream titles are to be preserved.

## Related

- [[fileManager]]
- [[video-processing-pipeline]]
