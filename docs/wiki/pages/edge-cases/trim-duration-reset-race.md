---
type: edge-case
tags: [VideoPlayer, trim, react, state, duration, handleLoadedMetadata]
updated: 2026-04-08
sources: 0
---

# Edge Case: Trim Leaves Duration = 0 After Reload (Race Condition)

**Trigger:** User trims a clip; `handleLoadedMetadata` fires quickly (local file serves fast) before `onTrimmed` → `setSelectedClip` completes.

**Symptom:** After trim, the video is correctly replaced on disk and reloads with the trimmed content, but the UI shows `duration = 0`, the progress bar is stuck at 0/0, and trying to enter trim mode again sets `clipEnd = 0` → Trim button disabled. The clip appears "unchanged."

**Root Cause:** `useEffect([media])` unconditionally called `setDuration(0)` and `setCurrentTime(0)` every time `media` changed — including when `onTrimmed` triggers `setSelectedClip` with the same-path clip after a successful trim. `handleLoadedMetadata` fires exactly once per video load. If it already fired and set `duration = trimmedDuration` before the media-change effect ran, the `setDuration(0)` call permanently zeroed the duration (the video src is unchanged, so no second `loadedmetadata` event arrives to correct it).

**Fix:** `setCurrentTime(0)` and `setDuration(0)` are now gated inside `if (pathChanged)`, exactly like the resume refs. When `pathChanged = false` (same-path re-render after trim), these values are left as-is — `handleLoadedMetadata` has either already set the correct trimmed value, or will set it when the load completes.

**Prevention:** Any state that is set by a one-shot DOM event (`loadedmetadata`, `canplaythrough`, etc.) must NOT be reset unconditionally in a media-change effect that also fires on same-path re-renders. Always gate with `pathChanged`.

## Related

- [[frontend-clip-trim-flow]]
- [[edge-case-trim-two-phase]]
