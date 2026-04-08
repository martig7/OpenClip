---
type: edge-case
tags: [VideoPlayer, trim, resume, playback, state, react]
updated: 2026-04-08
sources: 0
---

# Edge Case: Playback Position Preservation After Trim

**Trigger:** User trims a clip while the video is playing (or paused at a non-zero position).
**Symptom:** (Without the fix) After trim, the video restarts from 0 regardless of where the user was, and pauses even if it was playing.
**Root Cause:** Trim reloads the video element, which resets `currentTime` to 0 and pauses. The trim also changes the file's duration (the new file is shorter), so the old position may be out of range anyway.

**Fix:** `handleTrimClip` captures two refs *before* clearing the video src:
- `resumeAfterTrimRef.current = !videoRef.current.paused` — was it playing?
- `resumePositionRef.current = max(0, currentTime - clipStart)` — position translated into the new timeline (subtract trim start, since the trimmed clip begins at what was `clipStart`)

`handleLoadedMetadata` (fires after the reloaded video is ready) consumes these refs:
1. Seeks to `min(resumePositionRef.current, newDuration)` — clamped in case the user positioned at the very end
2. If `resumeAfterTrimRef.current` is true, calls `play()`
3. Clears both refs so they don't affect subsequent media changes

**The path-equality guard:** The state-reset effect that runs on `media` changes uses `media?.path !== lastMediaPathRef.current` to detect actual navigation. When `onTrimmed` fires, it passes the same media object with the same path — so the effect runs but detects `pathChanged = false` and skips clearing the resume refs. Without this guard, the refs would be wiped before `handleLoadedMetadata` could consume them.

## Related

- [[VideoPlayer]]
- [[frontend-clip-trim-flow]]
- [[edge-case-trim-two-phase]]
