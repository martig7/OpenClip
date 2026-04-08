---
type: edge-case
tags: [recordingService, clip, audio, ffmpeg, av-sync]
updated: 2026-04-08
sources: 0
---

# Edge Case: Multi-Track Clip Uses Three FFmpeg Passes

**Trigger:** User creates a clip with explicit audio track selection (one or more specific tracks chosen, not "all tracks").
**Symptom:** (Historical) A/V drift in clips created by reading video and audio separately from the source.
**Root Cause:** If ffmpeg reads the source twice (once for video, once for audio) with `-ss` seek, different key-frame distances per stream can cause the two reads to land at slightly different positions, producing A/V offset.
**Fix:** Three-pass strategy in `createClip`:
1. **Base cut** — one copy-cut of the time segment from the original source into a temp file. This is the only seek against the source.
2. **Video strip** — extract video stream only from the base cut (no seek drift).
3. **Audio build** — extract and process selected audio streams from the same base cut; apply `asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0` per track to reset timestamps; mix with `amix` if multiple tracks; encode to AAC 192k.
4. **Mux** — merge the video temp and audio temp into the final MP4 with `-movflags +faststart`.

All three intermediate files are deleted in a `finally` block regardless of success or failure.

**Why not use a single ffmpeg pass?** A single pass with `-filter_complex` mixing selected audio tracks while also copying video is possible but loses the fast-seek benefit on the source (the entire file must be read from the start for filter_complex). The base-cut intermediary gives back fast seek on the full-duration source while keeping A/V alignment on the per-stream operations.

## Related

- [[recordingService]]
- [[video-processing-pipeline]]
