---
type: edge-case
tags: [VideoPlayer, trim, react, state, media-change-effect, finalize, race]
updated: 2026-04-08
sources: 0
---

# Edge Case: Trim 2 Finalize Cancelled by Trim 1's handleTrimmed Re-render

**Trigger:** User trims a clip twice in quick succession — specifically, they start trim 2 fast enough that trim 1's `handleTrimmed → fetchClips` HTTP response arrives while trim 2's finalize phase is still in-flight.

**Symptom:** The video appears to reload (suppressVideoSrc toggled), but shows the old trimmed content (trim 1 result, not trim 2). The backend succeeds for both trims (both renames complete). The frontend discards the trim 2 result silently.

**Root Cause:**

The `media-change effect` (`useEffect([media])`) unconditionally called `setTrimFinalizePath(null)` and `setSuppressVideoSrc(false)` — even when `pathChanged = false` (same clip path, new object reference).

When trim 1 completes, it calls `onTrimmed → handleTrimmed → fetchClips()`. When `fetchClips()` returns, it calls `setSelectedClip(refreshedClip)`. This causes `media` to change (new object reference, same path), firing the `media-change effect` with `pathChanged = false`.

If trim 2's finalize effect is still awaiting the API response at that moment, the media-change effect sets `trimFinalizePath = null` — which is a dep of the finalize effect. The finalize effect cleanup runs, setting `cancelled = true`. When the finalize API response arrives, the `if (cancelled)` guard discards it. `videoReloadToken` never increments.

Meanwhile, `suppressVideoSrc` was restored to `false` by the media-change effect (not by the finalize success handler), so the video element reappears. But because the token didn't change, the video src URL is identical to the previous trim's URL. Chromium's HTTP cache may serve the stale response, so the user sees the trim-1 result instead of the trim-2 result.

**Fix:** Moved `setTrimFinalizePath(null)`, `setSuppressVideoSrc(false)`, `setTrimPending(false)`, `setVirtualTrimStart(null)`, and `setVirtualTrimEnd(null)` inside the `if (pathChanged)` block in the media-change effect. When the same clip re-renders with a new object reference (`pathChanged = false`), these values are left as-is — any in-progress finalize can complete uninterrupted.

**Prevention:** State that is actively used by an in-flight async operation (finalize effect) must not be reset by side-effects that fire for unrelated reasons (same-path media object re-renders). Gate all trim-operation state inside `if (pathChanged)`.

## Related

- [[frontend-clip-trim-flow]]
- [[edge-case-trim-duration-reset-race]]
- [[edge-case-trim-two-phase]]
