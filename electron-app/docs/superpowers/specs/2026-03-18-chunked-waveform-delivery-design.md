# Chunked Waveform Delivery

**Date:** 2026-03-18
**Status:** Approved

## Problem

On a cache miss, `/api/video/waveform` buffers the entire file's audio through FFmpeg before returning any data. For a ~2 GB / 30-minute recording, this produces a ~20-second blank waveform panel before anything renders. Once the cache is warm the endpoint is instant, but the first open of any recording — and any recording that wasn't pre-cached — hits this wall.

## Goal

Reduce time-to-first-waveform-pixel from ~20 s to ~1 s on cache miss, by delivering peaks in viewport-prioritized 30-second chunks and rendering them progressively.

---

## Architecture

### Fast path (unchanged)

`GET /api/video/waveform` continues to serve cache hits as today — a single JSON response with the full normalized peaks array. On a cache miss where FFmpeg produces no result (silent track, corrupt file, etc.) it continues to return `{ peaks: [] }`. **New:** on a cache miss where the file exists and has audio, it returns `{ status: "miss", duration }` (HTTP 200) instead of running FFmpeg — signalling the client to use the chunked path. This disambiguates "no audio" (`peaks: []`) from "go chunk" (`status: "miss"`).

### Slow path (new)

When the client receives `{ status: "miss" }` from `/api/video/waveform`, it switches to the chunked delivery path:

1. Divide the file's known duration into 30-second chunks.
2. Build a priority-ordered queue: viewport chunk first, then expand outward alternating left/right (viewport−1, viewport+1, viewport−2, viewport+2, …).
3. Drain the queue with a concurrency cap of **3** in-flight requests.
4. Each response splices raw peaks into the correct index range of a client-side accumulator array and triggers a renormalization + redraw.
5. When all chunks are received, issue a background request to `POST /api/video/waveform/cache` so the full waveform is stored server-side for future opens.

---

## API

### New endpoint — chunk

```
GET /api/video/waveform/chunk
  ?path=<encoded file path>
  &track=<int>
  &start=<float seconds>
  &end=<float seconds>
  &resolution=<low|default|high>
  &totalDuration=<float seconds>
```

**Server logic:**

1. Validate `path` via `isAllowedPath`, confirm file exists, validate `track`, `start`, `end`, `totalDuration`. Invalid `resolution` strings fall back to `'default'` (matching existing `getNumPeaks` behavior).
2. Derive `numPeaksTotal = getNumPeaks(resolution)` and `peaksForChunk = Math.round(numPeaksTotal * (end − start) / totalDuration)`.
3. Run FFmpeg with `-ss <start> -t <end−start>` to decode only the requested window. Request inherits the existing 30-second `setupProcessTimeout`.
4. Return **raw** (un-normalized) peaks — do not divide by max.
5. This endpoint must be matched in `apiServer.js` **before** the existing `/api/video/waveform` block, since the router uses exact-string `pathname ===` checks evaluated top-to-bottom.

**Response:**
```json
{
  "peaks": [0.031, 0.412, 0.887, ...],
  "startTime": 60,
  "endTime": 90,
  "numPeaksTotal": 1000
}
```

### New endpoint — background cache population

```
POST /api/video/waveform/cache
  body: { path, track, resolution }
```

Runs the existing `generateWaveform` → `setWaveform` pipeline in the background. Returns `202 Accepted` immediately. If the cache entry already exists when the job runs, it skips. This is fire-and-forget from the client's perspective.

---

## Server changes (`waveformUtils.js`)

Add `generateWaveformChunk(filePath, trackIndex, startTime, endTime, numPeaksForChunk)`:

- Spawns FFmpeg with `-ss <startTime> -t <chunkDuration>` (seeking before input for fast keyframe seek on MP4/MKV).
- Buffers stdout, converts to `Float32Array` via `bufferToSamples`.
- Calls a new `calculateRawPeaks(samples, numPeaksForChunk)` — identical to `calculatePeaks` but **omits the normalization step** (no divide-by-max).
- Returns `number[]` of raw peak values, or `null` on error.

`calculatePeaks` is unchanged — full-file cache path continues to return normalized peaks.

---

## Client changes

### `VideoPlayer.jsx` — waveform fetch logic

Replace the parallel `apiFetch('/api/video/waveform?...')` calls with a `fetchWaveformsChunked(media, duration, tracks)` function:

**State/ref additions:**
- `waveformRawPeaksRef`: `useRef(new Map())` — `Map<trackIndex, Float32Array>` of raw accumulated peaks per track, length `numPeaksTotal`.
- `waveformGlobalMaxRef`: `useRef(new Map())` — `Map<trackIndex, number>` running global max per track.
- `waveformChunksDoneRef`: `useRef(new Map())` — `Map<trackIndex, Set<chunkIndex>>` tracking which chunks have been received (a `useRef` not `useState` — completion tracking only, re-renders driven by `setWaveforms`).

**Sequencing:** The chunk queue must not start until `duration > 0`. Move the waveform fetch into the `useEffect` that already has `duration` as a dependency (the same effect used for markers), or add a guard that starts chunking only after the video element fires `onLoadedMetadata`. The `/api/video/waveform` miss-response now returns `{ status: "miss", duration }`, so the server-provided duration can also be used as a fallback if the video element hasn't fired yet.

**On media load:**
1. Clear all waveform state and refs.
2. Request `/api/video/waveform`. On `peaks` hit, set `waveforms` as today and return. On `peaks: []` (no audio), return. On `status: "miss"`, proceed to chunked path.
3. Initialize `waveformRawPeaksRef.current.set(track, new Float32Array(numPeaksTotal))` and `waveformGlobalMaxRef.current.set(track, 0)` for each track.

**Chunk queue:**
- Chunk size: 30 seconds. `numChunks = Math.ceil(duration / CHUNK_SIZE)`.
- Initial viewport chunk index: `viewportChunkRef.current ?? 0`. `viewportChunkRef` is updated by `onViewportChange` when `ZoomTimeline` is mounted. Fallback is chunk 0 (start of file) when `ZoomTimeline` is not yet mounted (e.g., user hasn't entered clip mode).
- Queue order: `[viewportIdx, viewportIdx−1, viewportIdx+1, viewportIdx−2, viewportIdx+2, ...]`, clamped to `[0, numChunks−1]`, deduped.
- Concurrency pool: simple counter `inFlight`, max 3. When a request completes, pull the next pending chunk.
- Abort all in-flight requests when `media` changes (existing `abortController` pattern).

**On chunk response:**
1. Splice received raw peaks into `rawPeaks` at the correct index range:
   ```
   startIdx = Math.round(startTime / duration * numPeaksTotal)
   endIdx   = Math.min(Math.round(endTime / duration * numPeaksTotal), numPeaksTotal)
   chunkPeaks = chunkPeaks.slice(0, endIdx - startIdx)  // guard against rounding overshoot
   rawPeaks.set(chunkPeaks, startIdx)
   ```
2. Update `globalMax` if any new peak exceeds the current max: `globalMax = Math.max(globalMax, ...chunkPeaks)`. Floor at `0.001` to prevent division-by-zero on silent segments: `globalMax = Math.max(globalMax, 0.001)`.
3. Recompute normalized display array: `normalizedPeaks = rawPeaks.map(v => v / globalMax)`.
4. Call `setWaveforms(prev => ({ ...prev, [track]: Array.from(normalizedPeaks) }))`.
   - Zero-filled gaps render as flat bars — no special handling needed in `AudioWaveformTrack`.

**On all chunks received:**
- Fire `POST /api/video/waveform/cache` for each track sequentially (not in parallel), best-effort, no error handling needed. Sequential firing avoids spawning multiple full-file FFmpeg processes simultaneously for multi-track recordings.

### `ZoomTimeline.jsx` — viewport reporting

Add optional prop `onViewportChange(viewStartSeconds: number)`. Report the viewport position via a `useEffect` that watches `actualViewStart`:

```js
useEffect(() => {
  onViewportChange?.(actualViewStart)
}, [actualViewStart])
```

This covers all cases: initial mount, user pan/zoom, zoom-fit resets, and duration changes — not just gesture handlers (which would miss the initial mount position entirely).

`VideoPlayer` uses this to update `viewportChunkRef`. If the chunk queue is still draining, reprioritize by inserting the new viewport chunk at the front of the pending queue array (after checking `waveformChunksDoneRef` to skip it if already received). The queue is a mutable array drained from index 0; reprioritization splices the new chunk to index 0 if it is not already in `waveformChunksDoneRef`. In-flight requests are not cancelled — the concurrency pool drains naturally and picks the reprioritized chunk next.

### `AudioWaveformTrack.jsx`

No changes required. Zero-filled gaps in the peaks array render as flat (height 1px minimum), which is correct placeholder behavior. The progressive re-render is driven by `waveforms` state updates in `VideoPlayer`.

---

## Normalization behavior

- **Chunk endpoint:** returns raw peaks (no normalization).
- **Client:** maintains running `globalMax` per track. On each chunk arrival, if `max(newChunkPeaks) > globalMax`, renormalize the full accumulated array and redraw. Otherwise only the newly spliced region needs visual update, but a full redraw is acceptable given array size (≤4000 floats).
- **Effect:** as louder sections arrive, previously rendered bars scale down proportionally. The waveform converges to its final normalized shape as chunks fill in.
- **Full-file cache path:** continues to return pre-normalized peaks as today; `globalMax` logic is bypassed.

---

## Edge cases

| Case | Handling |
|------|----------|
| File shorter than 30 s | One chunk covers full duration; chunked path behaves identically to current path |
| Last chunk shorter than 30 s | `end = duration` (capped); server FFmpeg `-t` naturally handles a short tail |
| User scrubs while loading | `viewportChunkRef` updated; next dequeued chunk is from new viewport position |
| Track has no audio | Server returns `{ peaks: [] }` (unchanged); client skips chunked path for that track |
| FFmpeg seek fails on a chunk | Chunk endpoint returns `{ peaks: [] }`; client skips splicing that chunk index; gap stays flat |
| Pre-cache finishes mid-load | Background cache populate fires at end of chunk queue; no conflict since `setWaveform` is idempotent |
| Silent chunk arrives first | `globalMax` floored at `0.001` before normalization; silent chunks render as flat |
| `ZoomTimeline` not mounted | `viewportChunkRef` is null; initial viewport chunk defaults to 0 |
| Two simultaneous cache POST calls for same file | Server checks cache before starting FFmpeg; whichever runs first populates it; second is a no-op |

---

## Non-goals

- Per-chunk server-side caching (unnecessary; the full-file cache covers warm opens).
- Changing the pre-caching system.
- Changing waveform resolution tiers or the resolution setting UI.
- Streaming via SSE (chunk polling is simpler and sufficient).

---

## Files to change

| File | Change |
|------|--------|
| `electron/waveformUtils.js` | Add `generateWaveformChunk`, `calculateRawPeaks` |
| `electron/apiServer.js` | Modify `/api/video/waveform` to return `{ status: "miss", duration }` on cache miss; add `/api/video/waveform/chunk` GET (registered *before* `/api/video/waveform` in routing order) and `/api/video/waveform/cache` POST handler |
| `src/viewer/components/VideoPlayer.jsx` | Replace waveform fetch with chunked delivery system |
| `src/viewer/components/ZoomTimeline.jsx` | Add `onViewportChange` prop and call it on viewport change |
