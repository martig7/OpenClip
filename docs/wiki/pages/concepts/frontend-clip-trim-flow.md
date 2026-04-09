---
type: concept
tags: [VideoPlayer, clip, trim, frontend, react, state, ipc]
updated: 2026-04-08
sources: 1
---

# Frontend Clip & Trim Flow

`VideoPlayer.jsx` owns all clip and trim UI state. This page documents the state machines for clip creation and trim — both are more involved than they look because of the two-phase trim protocol and the virtual-trim UX during FFmpeg processing.

## Clip Creation

### Entry
`enterClipMode()` initializes `clipStart = max(0, currentTime - 15)` and `clipEnd = min(duration, currentTime + 15)`, then expands the zoom timeline to fit the selection. The clip handles are immediately draggable.

### Audio track selection logic
`audio_tracks` is sent as a non-null array only when **all three** conditions hold:
1. The file has more than one audio track
2. At least one track is selected
3. Not all tracks are selected (partial selection)

If `audio_tracks` is null, `recordingService.createClip` uses the simple path (`-map 0 -c copy`). Passing an explicit array triggers the three-pass FFmpeg path. Sending null for "all tracks" avoids unnecessary passes.

### POST and response
`POST /api/clips/create` blocks until FFmpeg finishes. On success, `clipMode` is reset to false and `onClipCreated(data)` fires with the new clip's metadata.

---

## Trim

Trim involves six distinct state variables and a carefully ordered two-phase IPC sequence.

### State variables

| Variable | Purpose |
|---|---|
| `isTrimMode` | Whether trim (vs clip) mode is active |
| `clipStart / clipEnd` | The user-selected trim bounds (draggable on timeline) |
| `trimPending` | True from "Trim" button click until finalize completes; locks handles |
| `virtualTrimStart / virtualTrimEnd` | Applied as playback bounds during FFmpeg processing; shown on timeline |
| `suppressVideoSrc` | Clears the `<video src>` attribute to release the OS read handle |
| `trimFinalizePath` | Signals the finalize effect to run; set after src is suppressed |

### Phase 1 — FFmpeg (`handleTrimClip`)

1. Sets `virtualTrimStart/End` = clipStart/End immediately — the video now appears trimmed even though the file is unchanged
2. Sets `trimPending = true` — timeline handles become read-only
3. `POST /api/clips/trim` — **awaits FFmpeg completion** (can take several seconds for large files)
4. On success:
   - Captures `resumeAfterTrimRef.current = !videoRef.current.paused`
   - Captures `resumePositionRef.current = max(0, currentTime - clipStart)` — translates position into the new clip's timeline
   - `videoRef.current.removeAttribute('src'); videoRef.current.load()` — releases the OS read handle
   - Sets `suppressVideoSrc = true` and `trimFinalizePath = media.path`

### Phase 2 — Finalize (`useEffect` on `trimFinalizePath`)

1. Waits one tick (`setTimeout(0)`) so React commits the src removal to the DOM before the rename starts
2. The effect has a `cancelled` flag set in its cleanup to guard against React StrictMode's double-invocation firing two simultaneous finalize requests
3. `POST /api/clips/trim-finalize` — the backend renames `.tmp.mp4` over the original (polling on EPERM until the OS releases the handle)
4. On success: clears all trim state, increments `videoReloadToken`, calls `onTrimmed({ ...media })`

### Video reload after trim

`videoReloadToken` is appended to the `<video src>` URL as `&reload=N`. This forces the browser to re-fetch the file even though the path is unchanged. The `useEffect` watching `[suppressVideoSrc, videoReloadToken]` calls `videoRef.current.load()` once `suppressVideoSrc` is cleared.

When `handleLoadedMetadata` fires on the reloaded video, it checks `resumePositionRef.current` and seeks to that position (clamped to the new duration). If `resumeAfterTrimRef.current` is true, it also resumes playback — so the video restarts from approximately where it was before the trim.

### The path-equality guard on media change
When `media` changes, the effect that resets state checks `pathChanged = media?.path !== lastMediaPathRef.current`. If the path is **the same** (which happens when `onTrimmed` → `fetchClips` → `setSelectedClip` returns a fresh object for the same clip), the following states are intentionally **not** reset:

- `currentTime` and `duration` — `handleLoadedMetadata` fires exactly once per video load. If it already fired and set the correct trimmed values before `setSelectedClip` triggered the media-change effect, zeroing these would permanently corrupt them (no second `loadedmetadata` event arrives because `src` is unchanged). So they are only reset when `pathChanged = true`.
- `resumeAfterTrimRef` and `resumePositionRef` — preserved so `handleLoadedMetadata` can restore the seek position.
- `trimFinalizePath`, `suppressVideoSrc`, `trimPending`, `virtualTrimStart/End` — **must not be reset on same-path re-renders**. If the user starts a second trim quickly, `fetchClips` from the first `handleTrimmed` call can return and trigger a `pathChanged = false` re-render while the second trim's finalize effect is still awaiting the API. Resetting `trimFinalizePath` or `suppressVideoSrc` would change a dep of the finalize effect, running its cleanup (`cancelled = true`), causing the API response to be discarded. The video would then reload without incrementing `videoReloadToken`, serving the browser-cached pre-trim URL. See [[edge-case-trim-finalize-cancelled-by-media-rerender]].

---

## Virtual Trim During Processing

While `trimPending` is true and FFmpeg is running, `virtualTrimStart/End` enforce a fake trim region:

- `handleTimeUpdate` pauses and resets to `virtualTrimStart` if playback reaches `virtualTrimEnd`
- `handleSeek` and keyboard arrow keys pass through `clampPlaybackTime(time, duration, virtualTrimStart, virtualTrimEnd)`, which clamps seeks within `[virtualTrimStart, virtualTrimEnd]`
- The Timeline component receives these as `clipStart/clipEnd` with handles disabled (`onClipStartChange/onClipEndChange = undefined`)
- `enterTrimMode` snaps the cursor into the virtual region if it's outside bounds (via a dedicated `useEffect`)

This means the user can still scrub and play the "trimmed" portion while waiting for FFmpeg.

---

## Related

- [[video-processing-pipeline]]
- [[recordingService]]
- [[edge-case-trim-two-phase]]
- [[edge-case-trim-finalize-cancelled-by-media-rerender]]
- [[edge-case-trim-ffmpeg-stream-copy-duration]]
- [[frontend-waveform-loading]]
