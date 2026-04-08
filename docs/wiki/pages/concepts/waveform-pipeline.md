---
type: concept
tags: [waveform, waveformPreCache, waveformCache, waveformUtils, ffprobe, organize]
updated: 2026-04-08
sources: 0
---

# Waveform Pipeline

Waveforms are generated from audio streams using ffprobe/ffmpeg and cached in memory. Pre-caching happens automatically after organize/finalize so the waveform is ready before the user opens the recording.

## Flow

1. After `organizeRecordings` / `finalizeDirectRecording` / `organizeSpecificRecording` moves a file, `preCacheWaveform(movedPath)` is called fire-and-forget (errors are logged but don't block the organize flow).
2. `preCacheWaveform` probes the file with ffprobe to get audio stream indices, then generates peaks for up to 4 tracks.
3. Peaks are stored in `waveformCache` keyed by `(filePath, trackIndex, numPeaks)`.
4. When the frontend requests a waveform, the IPC handler checks the cache first; if missing, generates on demand.

## Key Points

- **`deleteFullRecording` ordering** — if the user has enabled deletion of the source recording after auto-clipping, fileManager explicitly `await`s the waveform pre-cache promise before deleting the file. Without this, the waveform would be generated against a deleted path.
- **Cache key includes mtime** — `videoMetadata.getVideoDuration` caches by `filePath:mtime`. After a trim (which restores original mtime), the cache key is unchanged, so the cached duration remains valid.
- **Max 500 entries, LRU eviction** — `_videoDurationCache` in `videoMetadata.js` evicts the oldest entry when it hits 500. The waveform cache in `waveformCache.js` has its own bounds.
- **Resolution setting** — `waveformResolution` (low/default/high) controls peak count; set at startup from `settings.waveformResolution` and updateable at runtime via `setWaveformResolution`.

## Related

- [[video-processing-pipeline]]
- [[fileManager]]
- [[recordingService]]
