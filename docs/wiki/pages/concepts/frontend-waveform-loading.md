---
type: concept
tags: [VideoPlayer, waveform, chunked, ffprobe, cache, performance]
updated: 2026-04-08
sources: 0
---

# Frontend Waveform Loading

Waveforms are loaded in two phases — a fast cache check, then chunked streaming — and the fetch queue is continuously reprioritized based on playback position.

## Phase 1 — Cache check

For each audio track, the frontend sends `GET /api/video/waveform?path=…&track=N&resolution=…`. The server responds with one of:
- `{ peaks: [...] }` — cache hit; used immediately
- `{ status: 'miss', duration: N }` — not cached; proceed to chunked delivery
- `{ peaks: [] }` — stream has no audio; no waveform rendered

## Phase 2 — Chunked delivery (on cache miss)

The file's duration is divided into 30-second chunks. A single prioritized queue covers all tracks; chunks are fetched in parallel across tracks but sequentially within the queue (max 3 in-flight total).

**Priority order:** viewport chunk first, then expanding outward alternating earlier/later. The queue is mutated in place by `reprioritizeQueue` so already-dispatched in-flight fetches complete normally while the pending remainder reorders.

**Reprioritization triggers:**
- Seek (`handleSeek`) — new viewport chunk = `floor(seekTarget / 30)`
- Playback crossing a chunk boundary (`handleTimeUpdate`)
- During buffering (`onWaiting`) and active seeking (`onSeeking`), waveform fetches are paused for 900–1800ms via `pauseWaveformFetchRef` to avoid contending with video data requests

**Peak accumulation:** Each chunk response writes its peaks into a `Float32Array` at the correct offset (calculated from `startTime / fileDuration * numPeaksTotal`). A running `globalMax` per track normalizes displayed peaks to `[0, 1]`. This means the displayed waveform amplitude adjusts as more chunks arrive — peaks can visually shrink if a later chunk has a higher maximum.

## Phase 3 — Background cache population

After all chunks complete, the frontend fires `POST /api/video/waveform/cache` for each track **sequentially** (not concurrently). This triggers the server to generate and persist the full waveform so future opens get a cache hit. Requests are fired sequentially to avoid running multiple long FFmpeg processes simultaneously.

## In-memory cache

`waveformCacheRef` (a `Map`) caches peak data in the renderer process keyed by `{path}:{trackIndex}:{resolution}`. It is cleared whenever `media` changes, preventing stale data when switching between files.

## Waveform resolution

`waveformResolution` is loaded from settings (`'low'`, `'default'`, `'high'`) and controls peak density. It is included in both cache keys and API requests, so changing resolution invalidates both the in-memory renderer cache and forces new server-side generation.

## Related

- [[frontend-clip-trim-flow]]
- [[waveform-pipeline]]
- [[video-processing-pipeline]]
