# Chunked Waveform Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce waveform time-to-first-pixel from ~20 s to ~1 s on cache miss by fetching peaks in viewport-prioritized 30-second chunks and rendering them progressively.

**Architecture:** The existing `/api/video/waveform` cache-hit path is unchanged. On a cache miss, it now returns `{ status: "miss", duration }` instead of running FFmpeg. The client uses this signal to start a priority-ordered chunk queue, fetching `/api/video/waveform/chunk` segments with FFmpeg `-ss` seeking. Raw peaks are accumulated client-side, renormalized on each chunk arrival, and rendered progressively. When all chunks are done, a background POST populates the server cache so the next open is instant.

**Tech Stack:** Node.js (CJS, plain HTTP server), React hooks (useRef/useState/useEffect/useCallback), FFmpeg `-ss` seeking, Vitest + MSW + supertest

**Spec:** `docs/superpowers/specs/2026-03-18-chunked-waveform-delivery-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `electron/waveformUtils.js` | Modify | Add `calculateRawPeaks`, `generateWaveformChunk`; export both |
| `electron/apiServer.js` | Modify | Import `generateWaveformChunk`; modify `/api/video/waveform` miss path; add `/api/video/waveform/chunk` GET (before waveform route); add `/api/video/waveform/cache` POST |
| `tests/unit/waveformUtils.chunked.test.js` | Create | Unit tests for `calculateRawPeaks` and `generateWaveformChunk` |
| `tests/api/video.test.js` | Modify | Update existing "returns normalized peaks" test; add tests for new endpoints |
| `tests/setup.js` | Modify | Add `calculateRawPeaks` and `generateWaveformChunk` to `vi.mock` for `waveformUtils.js` |
| `src/viewer/components/ZoomTimeline.jsx` | Modify | Add `onViewportChange` optional prop + `useEffect` to report `actualViewStart` |
| `src/viewer/components/VideoPlayer.jsx` | Modify | Add new refs; replace waveform fetch logic with chunked delivery; wire `onViewportChange` |
| `tests/components/VideoPlayer.test.jsx` | Modify | Add test: on `{ status: "miss" }` response, chunked requests are made and waveform renders |

---

## Task 1: `calculateRawPeaks` — unit test + implementation

**Files:**
- Create: `tests/unit/waveformUtils.chunked.test.js`
- Modify: `electron/waveformUtils.js`

`calculateRawPeaks` is identical to the existing `calculatePeaks` but returns un-normalized values (no divide-by-max step). It is a pure function — easy to test in isolation.

> **Note on test setup:** `tests/setup.js` applies `vi.mock('../electron/waveformUtils.js')` which intercepts ESM imports only. To test the real module, load it via `createRequire` (CJS) — this bypasses the ESM mock while still getting the mocked `child_process` from `Module._load` patching.

- [ ] **Step 1.1: Write the failing test**

Create `tests/unit/waveformUtils.chunked.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const _req = createRequire(import.meta.url)
const { calculateRawPeaks } = _req('../../electron/waveformUtils.js')

describe('calculateRawPeaks', () => {
  it('returns empty array for empty samples', () => {
    expect(calculateRawPeaks(new Float32Array([]), 10)).toEqual([])
  })

  it('returns at most numPeaks values', () => {
    const samples = new Float32Array(1000).fill(0.5)
    const peaks = calculateRawPeaks(samples, 10)
    expect(peaks.length).toBe(10)
  })

  it('returns raw amplitude values — max peak is NOT normalized to 1.0', () => {
    // Values are [0.2, 0.4] — raw max is 0.4, not 1.0
    const samples = new Float32Array([0.2, 0.2, 0.4, 0.4])
    const peaks = calculateRawPeaks(samples, 2)
    expect(peaks[0]).toBeCloseTo(0.2)
    expect(peaks[1]).toBeCloseTo(0.4)
    expect(peaks[1]).not.toBeCloseTo(1.0)
  })

  it('returns absolute values (handles negative samples)', () => {
    const samples = new Float32Array([-0.8, -0.8])
    const peaks = calculateRawPeaks(samples, 1)
    expect(peaks[0]).toBeCloseTo(0.8)
  })
})
```

- [ ] **Step 1.2: Run test to confirm it fails**

```
npm run test -- tests/unit/waveformUtils.chunked.test.js
```

Expected: `calculateRawPeaks is not a function` (function doesn't exist yet).

- [ ] **Step 1.3: Implement `calculateRawPeaks` in `electron/waveformUtils.js`**

Add after the existing `calculatePeaks` function (around line 59):

```js
/**
 * Calculate raw (un-normalized) waveform peaks from audio samples.
 * Identical to calculatePeaks but omits the normalization step.
 * @param {Float32Array} samples - Audio samples
 * @param {number} numPeaks - Number of peaks to generate
 * @returns {number[]} - Raw peak values (not divided by max)
 */
function calculateRawPeaks(samples, numPeaks) {
  if (!samples.length) return []

  const chunkSize = Math.max(1, Math.ceil(samples.length / numPeaks))
  const peaks = []

  for (let i = 0; i < samples.length && peaks.length < numPeaks; i += chunkSize) {
    let max = 0
    for (let j = i; j < Math.min(i + chunkSize, samples.length); j++) {
      const v = Math.abs(samples[j])
      if (v > max) max = v
    }
    peaks.push(max)
  }

  return peaks
}
```

Also add `calculateRawPeaks` to the `module.exports` at the bottom:

```js
module.exports = {
  createWaveformFFmpegProcess,
  calculatePeaks,
  calculateRawPeaks,
  getNumPeaks,
  setupProcessTimeout,
  bufferToSamples,
  generateWaveform,
}
```

- [ ] **Step 1.4: Run test to confirm it passes**

```
npm run test -- tests/unit/waveformUtils.chunked.test.js
```

Expected: all 4 tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add electron/waveformUtils.js tests/unit/waveformUtils.chunked.test.js
git commit -m "feat: add calculateRawPeaks to waveformUtils"
```

---

## Task 2: `generateWaveformChunk` — unit test + implementation

**Files:**
- Modify: `tests/unit/waveformUtils.chunked.test.js`
- Modify: `electron/waveformUtils.js`

`generateWaveformChunk` is like `generateWaveform` but uses `-ss startTime -t chunkDuration` (before `-i`) for fast seeking, and returns raw peaks via `calculateRawPeaks`. It does NOT call `getDuration` — the caller provides start/end/numPeaks.

`child_process` is mocked via `Module._load` in setup.js, so `spawn` is a `vi.fn()` available as `_cpMock.spawn`.

- [ ] **Step 2.1: Write the failing test**

Add to `tests/unit/waveformUtils.chunked.test.js`:

```js
import { vi } from 'vitest'
import { EventEmitter } from 'events'

// Access the shared child_process mock from setup.js
import { _cpMock } from '../setup.js'

// Add at top of describe block or as new describe:
describe('generateWaveformChunk', () => {
  const { generateWaveformChunk } = _req('../../electron/waveformUtils.js')

  function makeMockProc(floatData, exitCode = 0) {
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = { resume: vi.fn() }
    proc.kill = vi.fn()
    setTimeout(() => {
      if (floatData) proc.stdout.emit('data', Buffer.from(floatData.buffer))
      proc.emit('close', exitCode)
    }, 5)
    return proc
  }

  it('returns raw peaks array for valid audio', async () => {
    _cpMock.spawn.mockImplementationOnce(() =>
      makeMockProc(new Float32Array([0.2, 0.4, 0.6, 0.8]))
    )
    const peaks = await generateWaveformChunk('/fake/file.mp4', 0, 0, 30, 4)
    expect(peaks).not.toBeNull()
    expect(peaks.length).toBe(4)
    // Raw — highest value should be 0.8, not normalized to 1.0
    expect(Math.max(...peaks)).toBeCloseTo(0.8)
  })

  it('spawns ffmpeg with -ss before -i for fast seeking', async () => {
    _cpMock.spawn.mockImplementationOnce(() =>
      makeMockProc(new Float32Array([0.5]))
    )
    await generateWaveformChunk('/fake/file.mp4', 0, 60, 90, 1)
    const [, args] = _cpMock.spawn.mock.calls[0]
    const ssIndex = args.indexOf('-ss')
    const iIndex = args.indexOf('-i')
    expect(ssIndex).toBeGreaterThan(-1)
    expect(iIndex).toBeGreaterThan(-1)
    expect(ssIndex).toBeLessThan(iIndex) // -ss must come before -i
    expect(args[ssIndex + 1]).toBe('60') // correct start time
  })

  it('returns null when ffmpeg exits with non-zero code', async () => {
    _cpMock.spawn.mockImplementationOnce(() => makeMockProc(null, 1))
    const peaks = await generateWaveformChunk('/fake/file.mp4', 0, 0, 30, 10)
    expect(peaks).toBeNull()
  })

  it('returns null when ffmpeg emits an error', async () => {
    _cpMock.spawn.mockImplementationOnce(() => {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter()
      proc.stderr = { resume: vi.fn() }
      proc.kill = vi.fn()
      setTimeout(() => proc.emit('error', new Error('spawn failed')), 5)
      return proc
    })
    const peaks = await generateWaveformChunk('/fake/file.mp4', 0, 0, 30, 10)
    expect(peaks).toBeNull()
  })
})
```

- [ ] **Step 2.2: Run test to confirm it fails**

```
npm run test -- tests/unit/waveformUtils.chunked.test.js
```

Expected: `generateWaveformChunk is not a function`.

- [ ] **Step 2.3: Implement `generateWaveformChunk` in `electron/waveformUtils.js`**

Add after `generateWaveform` (before `module.exports`):

```js
/**
 * Generate raw waveform peaks for a specific time range in a video file.
 * Uses FFmpeg with -ss seek for fast keyframe-aligned seeks (MP4/MKV).
 * Returns raw (un-normalized) peaks, or null on error.
 * @param {string} filePath - Path to video file
 * @param {number} trackIndex - Audio track index
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 * @param {number} numPeaksForChunk - Number of peaks to generate for this chunk
 * @returns {Promise<number[]|null>}
 */
async function generateWaveformChunk(filePath, trackIndex, startTime, endTime, numPeaksForChunk) {
  try {
    const chunkDuration = endTime - startTime
    if (chunkDuration <= 0 || numPeaksForChunk <= 0) return null

    const sampleRate = Math.max(2, Math.round(numPeaksForChunk / chunkDuration))

    // -ss before -i: fast keyframe seek (avoids decoding from start)
    const ffmpegProc = spawn(FFMPEG_PATH, [
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', String(startTime),
      '-i', filePath,
      '-map', `0:a:${trackIndex}`,
      '-ac', '1',
      '-ar', String(sampleRate),
      '-t', String(chunkDuration),
      '-f', 'f32le',
      'pipe:1',
    ])
    setupProcessTimeout(ffmpegProc, 30_000)
    ffmpegProc.stderr.resume() // drain stderr to prevent pipe stall

    const chunks = []
    ffmpegProc.stdout.on('data', (chunk) => chunks.push(chunk))

    return new Promise((resolve) => {
      ffmpegProc.on('close', (code) => {
        if (code !== 0) { resolve(null); return }
        try {
          const buffer = Buffer.concat(chunks)
          const samples = bufferToSamples(buffer)
          if (!samples.length) { resolve(null); return }
          resolve(calculateRawPeaks(samples, numPeaksForChunk))
        } catch { resolve(null) }
      })
      ffmpegProc.on('error', () => resolve(null))
    })
  } catch { return null }
}
```

Add `generateWaveformChunk` to `module.exports`.

- [ ] **Step 2.4: Run tests to confirm they pass**

```
npm run test -- tests/unit/waveformUtils.chunked.test.js
```

Expected: all tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add electron/waveformUtils.js tests/unit/waveformUtils.chunked.test.js
git commit -m "feat: add generateWaveformChunk to waveformUtils"
```

---

## Task 3: Update `tests/setup.js` mock for `waveformUtils`

**Files:**
- Modify: `tests/setup.js`

The global `vi.mock` for `waveformUtils.js` in `setup.js` is used by component tests (ESM imports). Adding the new exports prevents `undefined` errors in any component test that touches the new functions.

- [ ] **Step 3.1: Update the vi.mock factory in `tests/setup.js`**

Locate the `vi.mock('../electron/waveformUtils.js', ...)` block (around line 62) and add the two new functions:

```js
vi.mock('../electron/waveformUtils.js', () => ({
  createWaveformFFmpegProcess: vi.fn(),
  calculatePeaks: vi.fn((samples, numPeaks) => []),
  calculateRawPeaks: vi.fn((samples, numPeaks) => Array.from({ length: numPeaks }, () => 0.5)),
  getNumPeaks: vi.fn((resolution = 'default') => {
    switch (resolution) {
      case 'low': return 1000
      case 'high': return 4000
      default: return 2000
    }
  }),
  setupProcessTimeout: vi.fn(),
  bufferToSamples: vi.fn((buffer) => new Float32Array()),
  generateWaveform: vi.fn().mockResolvedValue(null),
  generateWaveformChunk: vi.fn().mockResolvedValue(null),
}))
```

> **Note:** `generateWaveform` is also added here even though it was previously absent from the mock. The existing API tests load waveformUtils via CJS `require()` which bypasses `vi.mock`, so their behavior is unchanged. Component tests now get a safe mock instead of `undefined`.

- [ ] **Step 3.2: Run full test suite to confirm no regressions**

```
npm run test -- --reporter=verbose 2>&1 | tail -30
```

Expected: all previously passing tests still PASS. Pay particular attention to `tests/components/` — adding `generateWaveform` and `generateWaveformChunk` to the mock means any component test that previously got `undefined` for those now gets a `vi.fn()`. If any component test asserts `expect(generateWaveform).not.toHaveBeenCalled()` it will now work (previously it would throw); if it asserts `expect(generateWaveform).toBeUndefined()` it will now fail. Fix any such assertion to match the new mock.

- [ ] **Step 3.3: Commit**

```bash
git add tests/setup.js
git commit -m "test: add calculateRawPeaks and generateWaveformChunk to waveformUtils mock"
```

---

## Task 4: Modify `/api/video/waveform` — return `{ status: "miss" }` on cache miss

**Files:**
- Modify: `electron/apiServer.js`
- Modify: `tests/api/video.test.js`

On a cache miss where the file has valid audio (duration > 0), the endpoint now returns `{ status: "miss", duration }` and does NOT run FFmpeg. On a cache miss where duration is unavailable (corrupt file, no audio), it returns `{ peaks: [] }` as before.

- [ ] **Step 4.1: Update two existing tests and confirm the third is unchanged**

In `tests/api/video.test.js`:

**Test 1** — Rename and update `'returns normalized peaks for valid audio data'` (around line 226). After the change, a cache miss with a valid duration returns `{ status: "miss", duration }` — no FFmpeg spawn happens. Update the test:

```js
it('signals cache miss when file has audio (returns status: "miss" with duration)', async () => {
  const cp = await import('child_process')
  const fp = path.join(destDir, 'audio.mp4')
  fs.writeFileSync(fp, Buffer.alloc(1024))

  // execFile (ffprobe) returns a valid duration
  cp.execFile.mockImplementation((bin, args, opts, cb) => cb(null, '10', ''))

  const res = await request(server).get(
    `/api/video/waveform?path=${encodeURIComponent(fp)}&track=0`
  )
  expect(res.status).toBe(200)
  expect(res.body.status).toBe('miss')
  expect(res.body.duration).toBe(10)
  expect(res.body.peaks).toBeUndefined()
})
```

**Test 2** — Update `'returns 200 with empty peaks when ffmpeg spawn errors'` (around line 261). After the change, the endpoint calls `execFile` (ffprobe) for duration instead of spawning FFmpeg. If ffprobe returns a valid duration, the response is now `{ status: "miss" }`, not `{ peaks: [] }`. Since this test mocks `execFile` to return `'10'`, it will now receive a miss signal — update it to test the ffprobe-returns-no-duration path instead:

```js
it('returns empty peaks when ffprobe returns no duration', async () => {
  const cp = await import('child_process')
  const fp = path.join(destDir, 'nodur2.mp4')
  fs.writeFileSync(fp, Buffer.alloc(1024))

  cp.execFile.mockImplementation((bin, args, opts, cb) => cb(null, '', ''))

  const res = await request(server).get(
    `/api/video/waveform?path=${encodeURIComponent(fp)}&track=0`
  )
  expect(res.status).toBe(200)
  expect(res.body.peaks).toEqual([])
})
```

**Test 3** — `'returns empty peaks when ffprobe returns no duration'` (original, around line 212) tests the same path — keep or merge with Test 2 above, as you prefer. The original test also mocks `execFile` to return `''` so it maps to the same code path and should still pass after the change.

> **Why:** The `'spawn errors'` test is now redundant with the updated behavior — FFmpeg is never spawned on a cache miss. Repurposing it to cover a second no-duration variant is cleaner than deleting it.

- [ ] **Step 4.2: Run the waveform tests to confirm they fail correctly**

```
npm run test -- tests/api/video.test.js 2>&1 | grep -A3 "waveform"
```

Expected: the renamed/updated test FAILS (endpoint still runs FFmpeg and returns peaks).

- [ ] **Step 4.3: Modify `/api/video/waveform` in `electron/apiServer.js`**

In `apiServer.js` line 17, add `generateWaveformChunk` to the import (needed for later tasks):

```js
const { getNumPeaks, generateWaveform, generateWaveformChunk } = require('./waveformUtils')
```

Change the cache-miss path in the `/api/video/waveform` handler. Replace:

```js
const result = await generateWaveform(filePath, trackIndex, NUM_PEAKS, getVideoDuration)
if (!result) {
  return json(res, { peaks: [] })
}

// Store in cache
setWaveform(filePath, trackIndex, NUM_PEAKS, result.peaks, result.duration)
return json(res, { peaks: result.peaks, duration: result.duration })
```

With:

```js
// Cache miss — signal client to use chunked delivery
const duration = await getVideoDuration(filePath)
if (!duration) {
  return json(res, { peaks: [] })
}
return json(res, { status: 'miss', duration })
```

- [ ] **Step 4.4: Run tests to confirm they pass**

```
npm run test -- tests/api/video.test.js
```

Expected: all waveform tests PASS including the updated miss test.

- [ ] **Step 4.5: Commit**

```bash
git add electron/apiServer.js tests/api/video.test.js
git commit -m "feat: return {status:miss,duration} on waveform cache miss instead of running ffmpeg"
```

---

## Task 5: Add `/api/video/waveform/chunk` endpoint

**Files:**
- Modify: `electron/apiServer.js`
- Modify: `tests/api/video.test.js`

This endpoint runs FFmpeg with seek for a specific time window and returns raw peaks. It must be registered **before** the `/api/video/waveform` block in the routing chain.

- [ ] **Step 5.1: Write the failing tests**

Add a new `describe('GET /api/video/waveform/chunk', ...)` block to `tests/api/video.test.js`:

```js
describe('GET /api/video/waveform/chunk', () => {
  it('returns 400 for missing or invalid time params', async () => {
    const fp = path.join(destDir, 'chunk-test.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))
    const base = `/api/video/waveform/chunk?path=${encodeURIComponent(fp)}&track=0&resolution=default&totalDuration=120`
    // Missing start/end
    const r1 = await request(server).get(`${base}&start=abc&end=30`)
    expect(r1.status).toBe(400)
    // end <= start
    const r2 = await request(server).get(`${base}&start=30&end=10`)
    expect(r2.status).toBe(400)
  })

  it('returns 403 when path is outside allowed roots', async () => {
    const res = await request(server).get(
      '/api/video/waveform/chunk?path=C:\\evil.mp4&track=0&start=0&end=30&totalDuration=120'
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 when file does not exist', async () => {
    const fp = path.join(destDir, 'missing-chunk.mp4')
    const res = await request(server).get(
      `/api/video/waveform/chunk?path=${encodeURIComponent(fp)}&track=0&start=0&end=30&totalDuration=120`
    )
    expect(res.status).toBe(404)
  })

  it('returns raw peaks (max value is not necessarily 1.0)', async () => {
    const cp = await import('child_process')
    const fp = path.join(destDir, 'chunk-audio.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))

    cp.spawn.mockImplementation(() => {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter()
      proc.stderr = { resume: vi.fn() }
      proc.kill = vi.fn()
      // Emit 4 floats: max is 0.6 (not 1.0 — raw, not normalized)
      const floatArray = new Float32Array([0.2, 0.4, 0.6, 0.3])
      const buf = Buffer.from(floatArray.buffer)
      setTimeout(() => { proc.stdout.emit('data', buf); proc.emit('close', 0) }, 10)
      return proc
    })

    const res = await request(server).get(
      `/api/video/waveform/chunk?path=${encodeURIComponent(fp)}&track=0&start=0&end=30&resolution=default&totalDuration=120`
    )
    expect(res.status).toBe(200)
    expect(res.body.peaks.length).toBeGreaterThan(0)
    expect(res.body.startTime).toBe(0)
    expect(res.body.endTime).toBe(30)
    expect(res.body.numPeaksTotal).toBe(2000) // default resolution
    // Raw peaks — max should be ~0.6, not 1.0
    expect(Math.max(...res.body.peaks)).toBeLessThan(0.8)
  })

  it('returns empty peaks array when ffmpeg fails', async () => {
    const cp = await import('child_process')
    const fp = path.join(destDir, 'chunk-fail.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))

    cp.spawn.mockImplementation(() => {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter()
      proc.stderr = { resume: vi.fn() }
      proc.kill = vi.fn()
      setTimeout(() => proc.emit('close', 1), 10)
      return proc
    })

    const res = await request(server).get(
      `/api/video/waveform/chunk?path=${encodeURIComponent(fp)}&track=0&start=0&end=30&resolution=default&totalDuration=120`
    )
    expect(res.status).toBe(200)
    expect(res.body.peaks).toEqual([])
  })
})
```

- [ ] **Step 5.2: Run tests to confirm they fail (404 — route not yet added)**

```
npm run test -- tests/api/video.test.js -t "waveform/chunk"
```

Expected: all chunk tests FAIL (route returns 404).

- [ ] **Step 5.3: Add the `/api/video/waveform/chunk` route to `apiServer.js`**

Insert this block **immediately before** the existing `// GET /api/video/waveform?path=...` comment block (i.e., before line 420):

```js
// GET /api/video/waveform/chunk?path=...&track=0&start=0&end=30&resolution=default&totalDuration=1800
if (pathname === '/api/video/waveform/chunk' && req.method === 'GET') {
  const filePath = query.path
  const rawTrack = parseInt(query.track, 10)
  const startTime = parseFloat(query.start)
  const endTime = parseFloat(query.end)
  const totalDuration = parseFloat(query.totalDuration)
  const resolution = query.resolution || 'default'

  if (isNaN(rawTrack) || rawTrack < 0) return json(res, { error: 'Invalid track index' }, 400)
  if (
    isNaN(startTime) || isNaN(endTime) || isNaN(totalDuration) ||
    startTime < 0 || endTime <= startTime || totalDuration <= 0
  ) {
    return json(res, { error: 'Invalid time parameters' }, 400)
  }
  if (!filePath || !isAllowedPath(filePath)) return json(res, { error: 'Forbidden' }, 403)
  if (!fs.existsSync(filePath)) return json(res, { error: 'File not found' }, 404)

  const numPeaksTotal = getNumPeaks(resolution)
  const peaksForChunk = Math.max(1, Math.round(numPeaksTotal * (endTime - startTime) / totalDuration))

  const rawPeaks = await generateWaveformChunk(filePath, rawTrack, startTime, endTime, peaksForChunk)
  if (!rawPeaks || !rawPeaks.length) {
    return json(res, { peaks: [], startTime, endTime, numPeaksTotal })
  }
  return json(res, { peaks: rawPeaks, startTime, endTime, numPeaksTotal })
}
```

- [ ] **Step 5.4: Run tests to confirm they pass**

```
npm run test -- tests/api/video.test.js
```

Expected: all tests PASS including new chunk tests.

- [ ] **Step 5.5: Commit**

```bash
git add electron/apiServer.js tests/api/video.test.js
git commit -m "feat: add /api/video/waveform/chunk endpoint for progressive waveform delivery"
```

---

## Task 6: Add `POST /api/video/waveform/cache` endpoint

**Files:**
- Modify: `electron/apiServer.js`
- Modify: `tests/api/video.test.js`

Background cache population. Returns `202 Accepted` immediately and runs `generateWaveform → setWaveform` asynchronously. If already cached, it no-ops.

- [ ] **Step 6.1: Write the failing tests**

Add to `tests/api/video.test.js`:

```js
describe('POST /api/video/waveform/cache', () => {
  it('returns 202 immediately', async () => {
    const fp = path.join(destDir, 'cache-req.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))

    const res = await request(server)
      .post('/api/video/waveform/cache')
      .send({ path: fp, track: 0, resolution: 'default' })
    expect(res.status).toBe(202)
  })

  it('returns 403 for path outside allowed roots', async () => {
    const res = await request(server)
      .post('/api/video/waveform/cache')
      .send({ path: 'C:\\evil.mp4', track: 0, resolution: 'default' })
    expect(res.status).toBe(403)
  })

  it('returns 404 for missing file', async () => {
    const fp = path.join(destDir, 'nonexistent-cache.mp4')
    const res = await request(server)
      .post('/api/video/waveform/cache')
      .send({ path: fp, track: 0, resolution: 'default' })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 6.2: Run tests to confirm they fail**

```
npm run test -- tests/api/video.test.js -t "waveform/cache"
```

Expected: all cache tests FAIL.

- [ ] **Step 6.3: Add the `POST /api/video/waveform/cache` route to `apiServer.js`**

Insert immediately after the chunk endpoint block (before the existing `/api/video/waveform` GET block):

```js
// POST /api/video/waveform/cache — background cache population (fire-and-forget)
if (pathname === '/api/video/waveform/cache' && req.method === 'POST') {
  const data = await readBody(req)
  const { path: filePath, track, resolution } = data
  const rawTrack = parseInt(track, 10)

  if (isNaN(rawTrack) || rawTrack < 0) return json(res, { error: 'Invalid track index' }, 400)
  if (!filePath || !isAllowedPath(filePath)) return json(res, { error: 'Forbidden' }, 403)
  if (!fs.existsSync(filePath)) return json(res, { error: 'File not found' }, 404)

  // Respond immediately — background work runs after
  json(res, { status: 'accepted' }, 202)

  setImmediate(async () => {
    try {
      const NUM_PEAKS = getNumPeaks(resolution || 'default')
      const existing = getWaveform(filePath, rawTrack, NUM_PEAKS)
      if (existing?.peaks?.length) return // already cached — skip
      const result = await generateWaveform(filePath, rawTrack, NUM_PEAKS, getVideoDuration)
      if (result) {
        setWaveform(filePath, rawTrack, NUM_PEAKS, result.peaks, result.duration)
      }
    } catch {}
  })

  return
}
```

- [ ] **Step 6.4: Run all video API tests to confirm they pass**

```
npm run test -- tests/api/video.test.js
```

Expected: all tests PASS.

- [ ] **Step 6.5: Commit**

```bash
git add electron/apiServer.js tests/api/video.test.js
git commit -m "feat: add POST /api/video/waveform/cache for background cache population"
```

---

## Task 7: `ZoomTimeline.jsx` — add `onViewportChange` prop

**Files:**
- Modify: `src/viewer/components/ZoomTimeline.jsx`

Simple prop addition. A `useEffect` watching `actualViewStart` reports the current viewport start time to the parent. This fires on mount, zoom, pan, and zoom-fit — covering all cases.

- [ ] **Step 7.1: Add `onViewportChange` to `ZoomTimeline.jsx`**

In the destructured props list (around line 9), add `onViewportChange`:

```js
const ZoomTimeline = forwardRef(function ZoomTimeline({
  currentTime,
  duration,
  onSeek,
  clipStart,
  clipEnd,
  onClipStartChange,
  onClipEndChange,
  markers = [],
  onMarkerClick,
  audioTracks = [],
  selectedTracks = [],
  waveforms = {},
  onTrackToggle,
  isCreatingClip = false,
  isExpanded = false,
  onViewportChange,     // <-- add this
}, ref) {
```

After the existing `useEffect` blocks (after around line 48), add:

```js
// Report viewport position to parent whenever it changes
useEffect(() => {
  onViewportChange?.(actualViewStart)
}, [actualViewStart])
```

- [ ] **Step 7.2: Run the full test suite to confirm no regressions**

```
npm run test -- --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS (the prop is optional so no existing test breaks).

- [ ] **Step 7.3: Commit**

```bash
git add src/viewer/components/ZoomTimeline.jsx
git commit -m "feat: add onViewportChange prop to ZoomTimeline for viewport reporting"
```

---

## Task 8: `VideoPlayer.jsx` — chunked waveform delivery

**Files:**
- Modify: `src/viewer/components/VideoPlayer.jsx`
- Modify: `tests/components/VideoPlayer.test.jsx`

This is the largest task. Replace the existing waveform fetch logic with the chunked delivery system. Keep the in-memory client cache (fast path for re-opening the same file).

### Constants and new refs

- [ ] **Step 8.1: Write the failing test first**

In `tests/components/VideoPlayer.test.jsx`, add a new test for the chunked delivery path. The test mocks `/api/video/waveform` to return `{ status: "miss", duration: 60 }` and `/api/video/waveform/chunk` to return peaks for each chunk, then asserts the waveform renders.

Add this test after the existing waveform tests:

```js
it('fetches chunks when waveform endpoint signals cache miss', async () => {
  server.use(
    http.get('/api/video/tracks', () => HttpResponse.json({ tracks: sampleAudioTracks })),
    http.get('/api/video/waveform', () =>
      HttpResponse.json({ status: 'miss', duration: 60 })
    ),
    http.get('/api/video/waveform/chunk', ({ request }) => {
      const url = new URL(request.url)
      const start = parseFloat(url.searchParams.get('start'))
      const end = parseFloat(url.searchParams.get('end'))
      return HttpResponse.json({
        peaks: [0.3, 0.5, 0.4],
        startTime: start,
        endTime: end,
        numPeaksTotal: 1000,
      })
    }),
    http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
    http.post('/api/video/waveform/cache', () => new HttpResponse(null, { status: 202 }))
  )

  renderPlayer(sampleRecording)
  await waitFor(() => screen.getByTestId('enter-clip-btn'))

  // Enter clip mode so ZoomTimeline mounts and waveform panel is visible
  fireEvent.click(screen.getByTestId('enter-clip-btn'))

  // Wait for at least one chunk to be rendered (waveform canvas appears)
  await waitFor(() => {
    const canvases = document.querySelectorAll('.audio-waveform-canvas')
    expect(canvases.length).toBeGreaterThan(0)
  }, { timeout: 3000 })
})
```

- [ ] **Step 8.2: Run the test to confirm it fails**

```
npm run test -- tests/components/VideoPlayer.test.jsx -t "fetches chunks"
```

Expected: test FAILS (no chunk requests are made, waveform stays empty).

- [ ] **Step 8.3: Add the chunk delivery constants and new refs to `VideoPlayer.jsx`**

After the existing waveform refs (around line 68), add:

```js
const WAVEFORM_CHUNK_SIZE = 30 // seconds per chunk
const WAVEFORM_MAX_INFLIGHT = 3 // max concurrent chunk requests per track (spec: 3)

// Chunked delivery refs (cleared on media change)
const waveformRawPeaksRef = useRef(new Map())
const waveformGlobalMaxRef = useRef(new Map())
const waveformChunksDoneRef = useRef(new Map())
const viewportChunkRef = useRef(null)
```

In the media reset `useEffect` (around line 84, the effect with `[media]` dependency), add after `waveformCacheRef.current.clear()`:

```js
waveformRawPeaksRef.current.clear()
waveformGlobalMaxRef.current.clear()
waveformChunksDoneRef.current.clear()
viewportChunkRef.current = null
```

- [ ] **Step 8.4: Add the `handleViewportChange` callback**

After the media reset effect, add:

```js
const handleViewportChange = useCallback((viewStartSeconds) => {
  viewportChunkRef.current = Math.floor(viewStartSeconds / WAVEFORM_CHUNK_SIZE)
}, [])
```

- [ ] **Step 8.5: Add the `buildChunkQueue` helper**

Add (outside the component, at module scope, near the top of the file):

```js
function buildChunkQueue(numChunks, viewportIdx) {
  const queue = []
  const seen = new Set()
  const add = (i) => {
    if (i >= 0 && i < numChunks && !seen.has(i)) {
      queue.push(i)
      seen.add(i)
    }
  }
  add(viewportIdx)
  for (let delta = 1; delta < numChunks; delta++) {
    add(viewportIdx - delta)
    add(viewportIdx + delta)
  }
  return queue
}
```

- [ ] **Step 8.6: Replace the waveform fetch logic inside the `fetchTracks` effect**

In the `useEffect([media, waveformResolution])` block, find the waveform fetch section (lines 129–166):

```js
// Fetch waveforms in parallel with concurrent requests
const waveformPromises = data.tracks.map(async (track, trackIndex) => {
  ...
})
await Promise.allSettled(waveformPromises)
```

Replace the entire `waveformPromises` block with:

```js
// Fetch waveforms — cache hit: use full peaks immediately; miss: chunked delivery
await Promise.allSettled(data.tracks.map(async (track, trackIndex) => {
  if (cancelled) return

  // In-memory client cache check (unchanged)
  const cacheKey = `${media.path}:${trackIndex}:${waveformResolution}`
  const cached = waveformCacheRef.current.get(cacheKey)
  if (cached) {
    setWaveforms((prev) => ({ ...prev, [trackIndex]: cached.peaks }))
    return
  }

  let waveRes, waveData
  try {
    waveRes = await apiFetch(
      `/api/video/waveform?path=${encodeURIComponent(media.path)}&track=${trackIndex}&resolution=${waveformResolution}`,
      { signal: abortController.signal }
    )
    if (cancelled) return
    waveData = await waveRes.json()
    if (cancelled) return
  } catch (e) {
    if (e.name !== 'AbortError') console.error(`Waveform fetch failed for track ${trackIndex}:`, e)
    return
  }

  // Cache hit — full normalized peaks
  if (waveRes.ok && waveData.peaks?.length) {
    waveformCacheRef.current.set(cacheKey, { peaks: waveData.peaks })
    setWaveforms((prev) => ({ ...prev, [trackIndex]: waveData.peaks }))
    return
  }

  // No audio — nothing to do
  if (!waveData.status) return

  // Cache miss — start chunked delivery
  const fileDuration = waveData.duration
  if (!fileDuration) return

  // Derive numPeaksTotal locally — the miss response does not include it
  const numPeaksTotal = waveformResolution === 'low' ? 1000 : waveformResolution === 'high' ? 4000 : 2000

  waveformRawPeaksRef.current.set(trackIndex, new Float32Array(numPeaksTotal))
  waveformGlobalMaxRef.current.set(trackIndex, 0)
  waveformChunksDoneRef.current.set(trackIndex, new Set())

  const numChunks = Math.ceil(fileDuration / WAVEFORM_CHUNK_SIZE)
  const viewportIdx = viewportChunkRef.current ?? 0
  const queue = buildChunkQueue(numChunks, viewportIdx)

  let inFlight = 0

  async function fetchNext() {
    if (cancelled) return

    if (queue.length === 0) {
      if (inFlight === 0) {
        // All chunks done — trigger background cache population (best-effort)
        apiPost('/api/video/waveform/cache', {
          path: media.path, track: trackIndex, resolution: waveformResolution,
        }).catch(() => {})
      }
      return
    }

    const chunkIdx = queue.shift()
    const done = waveformChunksDoneRef.current.get(trackIndex)
    if (done?.has(chunkIdx)) { fetchNext(); return }

    const startTime = chunkIdx * WAVEFORM_CHUNK_SIZE
    const endTime = Math.min(startTime + WAVEFORM_CHUNK_SIZE, fileDuration)

    inFlight++
    try {
      const chunkRes = await apiFetch(
        `/api/video/waveform/chunk?path=${encodeURIComponent(media.path)}&track=${trackIndex}&start=${startTime}&end=${endTime}&resolution=${waveformResolution}&totalDuration=${fileDuration}`,
        { signal: abortController.signal }
      )
      if (cancelled) return
      const chunkData = await chunkRes.json()
      if (cancelled) return

      if (chunkRes.ok && chunkData.peaks?.length) {
        const rawPeaks = waveformRawPeaksRef.current.get(trackIndex)
        const prevMax = waveformGlobalMaxRef.current.get(trackIndex) || 0

        const startIdx = Math.round(chunkData.startTime / fileDuration * numPeaksTotal)
        const endIdx = Math.min(Math.round(chunkData.endTime / fileDuration * numPeaksTotal), numPeaksTotal)
        const spliceData = new Float32Array(chunkData.peaks.slice(0, endIdx - startIdx))
        rawPeaks.set(spliceData, startIdx)

        const chunkMax = spliceData.reduce((m, v) => (v > m ? v : m), 0)
        const newMax = Math.max(prevMax, chunkMax, 0.001)
        waveformGlobalMaxRef.current.set(trackIndex, newMax)

        const normalizedPeaks = Array.from(rawPeaks).map((v) => v / newMax)
        setWaveforms((prev) => ({ ...prev, [trackIndex]: normalizedPeaks }))

        done?.add(chunkIdx)
      }
    } catch (e) {
      if (e.name !== 'AbortError' && !cancelled) {
        console.warn(`Chunk ${chunkIdx} for track ${trackIndex} failed:`, e)
      }
    }

    inFlight--
    fetchNext()
  }

  // Start up to WAVEFORM_MAX_INFLIGHT concurrent fetches
  for (let i = 0; i < Math.min(WAVEFORM_MAX_INFLIGHT, numChunks); i++) {
    fetchNext()
  }
}))
```

> **Note:** `apiFetch` currently only accepts a path string + options. The cache POST call above uses it with a method/body — verify `apiFetch` supports this by checking `src/viewer/apiBase.js`. If it only accepts GET, use `apiPost` instead, or use the native `fetch` with the full URL from `getBase()`.

- [ ] **Step 8.7: Wire `onViewportChange` to `ZoomTimeline` in the JSX**

Find the `<ZoomTimeline ... />` usage in `VideoPlayer.jsx` (around line 600). Add the `onViewportChange` prop:

```jsx
<ZoomTimeline
  ref={zoomTimelineRef}
  currentTime={currentTime}
  duration={duration}
  onSeek={handleSeek}
  clipStart={clipStart}
  clipEnd={clipEnd}
  onClipStartChange={setClipStart}
  onClipEndChange={setClipEnd}
  markers={markers}
  onMarkerClick={handleMarkerClick}
  audioTracks={audioTracks}
  selectedTracks={selectedTracks}
  waveforms={waveforms}
  onTrackToggle={toggleTrack}
  isCreatingClip={isCreatingClip}
  isExpanded={isZoomTimelineExpanded}
  onViewportChange={handleViewportChange}   // <-- add this
/>
```

- [ ] **Step 8.8: Confirm `apiPost` is imported in `VideoPlayer.jsx`**

Check the import line at the top of `VideoPlayer.jsx` for `apiBase.js`. It should include `apiPost`. If it only imports `apiFetch`, add `apiPost` to the import. The cache trigger in `fetchNext` uses `apiPost` — ensure it is available.

- [ ] **Step 8.9: Run the VideoPlayer test to confirm it passes**

```
npm run test -- tests/components/VideoPlayer.test.jsx
```

Expected: all tests PASS including the new chunked delivery test.

- [ ] **Step 8.10: Run the full test suite**

```
npm run test -- --reporter=verbose 2>&1 | tail -30
```

Expected: all tests PASS with no regressions.

- [ ] **Step 8.11: Commit**

```bash
git add src/viewer/components/VideoPlayer.jsx tests/components/VideoPlayer.test.jsx
git commit -m "feat: progressive chunked waveform delivery on cache miss"
```

---

## Task 9: Final integration check

- [ ] **Step 9.1: Run the full test suite one final time**

```
npm run test
```

Expected: all tests PASS. Zero failures.

- [ ] **Step 9.2: Commit docs update if needed**

If any inline comments or docs need updating:

```bash
git add -A
git commit -m "docs: update inline comments for chunked waveform delivery"
```
