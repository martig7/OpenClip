/**
 * API-level ffmpeg integration tests.
 *
 * Starts the real HTTP API server (only `electron` is stubbed; child_process is live).
 * Runs actual ffmpeg/ffprobe binaries for clip creation, re-encode, waveform
 * generation, and track detection.
 *
 * Covers TEST_COVERAGE_ANALYSIS.md items #77 and #78 (previously PENDING).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createRequire } from 'module'

const _req = createRequire(import.meta.url)
const ffmpegPath = _req('ffmpeg-static')
const ffprobePath = _req('ffprobe-static').path

// ── Probe helpers ─────────────────────────────────────────────────────────────

function probeDuration(filePath) {
  const out = execFileSync(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { encoding: 'utf-8', timeout: 10_000 }
  )
  return parseFloat(out.trim())
}

function probeVideoCodec(filePath) {
  const out = execFileSync(
    ffprobePath,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { encoding: 'utf-8', timeout: 10_000 }
  )
  return out.trim()
}

function readAudioPcmPeak(filePath, streamIndex, startSec, durationSec) {
  const pcm = execFileSync(
    ffmpegPath,
    [
      '-v',
      'error',
      '-ss',
      String(startSec),
      '-t',
      String(durationSec),
      '-i',
      filePath,
      '-map',
      `0:a:${streamIndex}`,
      '-ac',
      '1',
      '-ar',
      '48000',
      '-f',
      's16le',
      'pipe:1',
    ],
    { timeout: 20_000 }
  )
  if (!pcm || pcm.length < 2) return 0
  let peak = 0
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const sample = Math.abs(pcm.readInt16LE(i))
    if (sample > peak) peak = sample
  }
  return peak
}

function countUniqueGrayFrames(filePath, startSec, durationSec, fps = 12) {
  const width = 32
  const height = 32
  const frameSize = width * height
  const raw = execFileSync(
    ffmpegPath,
    [
      '-v',
      'error',
      '-ss',
      String(startSec),
      '-t',
      String(durationSec),
      '-i',
      filePath,
      '-vf',
      `fps=${fps},scale=${width}:${height},format=gray`,
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { timeout: 20_000 }
  )
  const unique = new Set()
  for (let off = 0; off + frameSize <= raw.length; off += frameSize) {
    unique.add(raw.subarray(off, off + frameSize).toString('base64'))
  }
  return unique.size
}

function firstAudioOnsetSec(filePath, streamIndex, searchWindowSec = 1.5) {
  const sampleRate = 48000
  const pcm = execFileSync(
    ffmpegPath,
    [
      '-v',
      'error',
      '-ss',
      '0',
      '-t',
      String(searchWindowSec),
      '-i',
      filePath,
      '-map',
      `0:a:${streamIndex}`,
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      'pipe:1',
    ],
    { timeout: 20_000 }
  )
  if (!pcm || pcm.length < 2) return Infinity
  const windowSamples = Math.floor(sampleRate * 0.02) // 20 ms
  const totalSamples = Math.floor(pcm.length / 2)
  for (let sampleIdx = 0; sampleIdx + windowSamples <= totalSamples; sampleIdx += windowSamples) {
    let peak = 0
    for (let i = 0; i < windowSamples; i++) {
      const s = Math.abs(pcm.readInt16LE((sampleIdx + i) * 2))
      if (s > peak) peak = s
    }
    if (peak > 900) return sampleIdx / sampleRate
  }
  return Infinity
}

function firstBrightFrameSec(filePath, searchWindowSec = 1.5, fps = 50) {
  const width = 64
  const height = 36
  const frameSize = width * height
  const raw = execFileSync(
    ffmpegPath,
    [
      '-v',
      'error',
      '-ss',
      '0',
      '-t',
      String(searchWindowSec),
      '-i',
      filePath,
      '-vf',
      `fps=${fps},scale=${width}:${height},format=gray`,
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { timeout: 20_000 }
  )
  const frameCount = Math.floor(raw.length / frameSize)
  for (let frameIdx = 0; frameIdx < frameCount; frameIdx++) {
    const off = frameIdx * frameSize
    let sum = 0
    for (let i = 0; i < frameSize; i++) sum += raw[off + i]
    const mean = sum / frameSize
    if (mean > 170) return frameIdx / fps
  }
  return Infinity
}

// ── Store factory ─────────────────────────────────────────────────────────────

function makeStore(obsDir, destDir) {
  const data = {
    settings: { obsRecordingPath: obsDir, destinationPath: destDir, autoClip: null },
    lockedRecordings: [],
    storageSettings: {},
  }
  return {
    get: (key) => key.split('.').reduce((o, k) => o?.[k], data),
    set: () => {},
    _data: data,
  }
}

// ── Fixtures — generated once for the whole suite ─────────────────────────────

let fixtureSilentMp4 // 3-second MP4, no audio track (clips & reencode tests)
let fixtureAudioMp4 // 3-second MP4, video + 440 Hz sine audio (waveform & tracks tests)
let fixturePulseTracksMp4 // 24-second MP4, moving video + pulsed flash/audio markers

beforeAll(() => {
  const tmp = os.tmpdir()
  fixtureSilentMp4 = path.join(tmp, 'openclip-api-silent.mp4')
  fixtureAudioMp4 = path.join(tmp, 'openclip-api-audio.mp4')
  fixturePulseTracksMp4 = path.join(tmp, 'openclip-api-pulse-tracks.mp4')

  // Silent video — stream-copy-safe for clip extraction
  execFileSync(
    ffmpegPath,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=3:size=32x32:rate=1',
      '-c:v',
      'libx264',
      '-crf',
      '51',
      '-preset',
      'ultrafast',
      '-an',
      fixtureSilentMp4,
    ],
    { timeout: 30_000 }
  )

  // Video + audio — required for waveform and track-detection tests
  execFileSync(
    ffmpegPath,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=3:size=32x32:rate=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3',
      '-c:v',
      'libx264',
      '-crf',
      '51',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-b:a',
      '32k',
      fixtureAudioMp4,
    ],
    { timeout: 30_000 }
  )

  // Moving video + 3 pulsed audio tracks. Pulses happen at the start of each
  // second so we can assert clip-start audio alignment after track selection.
  execFileSync(
    ffmpegPath,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      "testsrc2=duration=24:size=128x72:rate=30,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.9:t=fill:enable='lt(mod(t,1),0.12)'",
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=if(lt(mod(t\\,1)\\,0.12)\\,0.85*sin(2*PI*440*t)\\,0):s=48000:d=24',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=if(lt(mod(t\\,1)\\,0.12)\\,0.85*sin(2*PI*880*t)\\,0):s=48000:d=24',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=if(lt(mod(t\\,1)\\,0.12)\\,0.85*sin(2*PI*1760*t)\\,0):s=48000:d=24',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-map',
      '2:a:0',
      '-map',
      '3:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '90',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-shortest',
      fixturePulseTracksMp4,
    ],
    { timeout: 45_000 }
  )
}, 60_000)

afterAll(() => {
  try {
    fs.unlinkSync(fixtureSilentMp4)
  } catch {}
  try {
    fs.unlinkSync(fixtureAudioMp4)
  } catch {}
  try {
    fs.unlinkSync(fixturePulseTracksMp4)
  } catch {}
})

// ── Shared server — one per test file (avoids module-level store conflicts) ────

let server, store, tmpDir, obsDir, destDir

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-api-ffmpeg-'))
  obsDir = path.join(tmpDir, 'obs')
  destDir = path.join(tmpDir, 'dest')
  fs.mkdirSync(obsDir, { recursive: true })
  fs.mkdirSync(destDir, { recursive: true })

  store = makeStore(obsDir, destDir)
  const { startApiServer } = await import('../../../electron/apiServer.js')
  server = startApiServer(store)
  await new Promise((resolve) => server.on('listening', resolve))
}, 10_000)

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Remove any clips produced by the previous test so clip counters reset.
  // Clips now live under dest/{GameName}/Clips/ (per-game structure).
  const clipsDir = path.join(destDir, 'ClipGame', 'Clips')
  if (fs.existsSync(clipsDir)) {
    for (const f of fs.readdirSync(clipsDir)) {
      try {
        fs.rmSync(path.join(clipsDir, f), { force: true })
      } catch {}
    }
  }
})

// ── POST /api/clips/create ────────────────────────────────────────────────────

describe('POST /api/clips/create — real ffmpeg', () => {
  it('produces a valid MP4 with a positive duration (#77)', async () => {
    const src = path.join(obsDir, 'session-clips.mp4')
    fs.copyFileSync(fixtureSilentMp4, src)

    const res = await request(server)
      .post('/api/clips/create')
      .send({ source_path: src, start_time: 0, end_time: 1.5, game_name: 'ClipGame' })

    expect(res.status).toBe(200)
    expect(res.body.filename).toMatch(/^ClipGame Clip \d{4}-\d{2}-\d{2} #1\.mp4$/)

    const clipsDir = path.join(destDir, 'ClipGame', 'Clips')
    const clips = fs.readdirSync(clipsDir).filter((f) => f.endsWith('.mp4'))
    expect(clips).toHaveLength(1)

    const duration = probeDuration(path.join(clipsDir, clips[0]))
    expect(duration).toBeGreaterThan(0)
    expect(duration).toBeLessThan(3) // requested 1.5 s; allow rounding
  })

  it('keeps clip-start audio aligned and avoids frozen opening frames when selecting tracks', async () => {
    const src = path.join(obsDir, 'session-selected-tracks.mp4')
    fs.copyFileSync(fixturePulseTracksMp4, src)
    const clipStart = 2.0
    const clipEnd = 22.0
    const clipDurationSec = clipEnd - clipStart

    const t0 = Date.now()
    const res = await request(server).post('/api/clips/create').send({
      source_path: src,
      start_time: clipStart,
      end_time: clipEnd,
      game_name: 'ClipGame',
      audio_tracks: [0, 1],
    })
    const elapsedMs = Date.now() - t0

    expect(res.status).toBe(200)
    const outPath = res.body.path
    expect(typeof outPath).toBe('string')
    expect(fs.existsSync(outPath)).toBe(true)

    // Track 0 in output is the mixed selected-track output.
    // It should have audible content right near clip start (not 1s muted).
    const earlyPeak = readAudioPcmPeak(outPath, 0, 0.02, 0.18)
    expect(earlyPeak).toBeGreaterThan(900)

    // Video should not be frozen at start: early segment must contain several
    // unique frames from the moving source.
    const uniqueEarlyFrames = countUniqueGrayFrames(outPath, 0, 0.8, 12)
    expect(uniqueEarlyFrames).toBeGreaterThanOrEqual(4)

    // A/V sync check: first bright visual pulse and first audio pulse should
    // be close at clip start.
    const audioOnsetSec = firstAudioOnsetSec(outPath, 0, 1.5)
    const videoOnsetSec = firstBrightFrameSec(outPath, 1.5, 50)
    expect(audioOnsetSec).toBeLessThan(1.5)
    expect(videoOnsetSec).toBeLessThan(1.5)
    expect(Math.abs(audioOnsetSec - videoOnsetSec)).toBeLessThan(0.2)

    // Tail-audio check: the final second should still contain audible signal
    // (guards against regressions where the clip end is muted).
    const tailPeak = readAudioPcmPeak(outPath, 0, clipDurationSec - 0.98, 0.2)
    expect(tailPeak).toBeGreaterThan(900)

    // Performance indicator (non-blocking): log ratio for trend tracking.
    // Keep only a very loose ceiling to catch hangs/regressions without
    // introducing flaky hardware-dependent failures.
    const ratio = elapsedMs / (clipDurationSec * 1000)
    console.log(
      `[test-perf] selected-track-create elapsed_ms=${elapsedMs} clip_seconds=${clipDurationSec} ratio=${ratio.toFixed(4)}`
    )
    expect(ratio).toBeLessThan(1.0)
  })
})

// ── POST /api/reencode ────────────────────────────────────────────────────────

describe('POST /api/reencode — real ffmpeg', () => {
  it('reencodes to h264 and produces a playable MP4 (#78)', async () => {
    const src = path.join(destDir, 'reencode-h264.mp4')
    fs.copyFileSync(fixtureSilentMp4, src)

    const res = await request(server)
      .post('/api/reencode')
      .send({ source_path: src, codec: 'h264', crf: 51, preset: 'ultrafast' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const outPath = res.body.output_path
    expect(fs.existsSync(outPath)).toBe(true)
    expect(probeDuration(outPath)).toBeGreaterThan(0)
    expect(probeVideoCodec(outPath)).toBe('h264')
  })

  it('replace_original: true atomically replaces the source file (#78)', async () => {
    const src = path.join(destDir, 'reencode-replace.mp4')
    fs.copyFileSync(fixtureSilentMp4, src)

    const res = await request(server)
      .post('/api/reencode')
      .send({
        source_path: src,
        codec: 'h264',
        crf: 51,
        preset: 'ultrafast',
        replace_original: true,
      })

    expect(res.status).toBe(200)
    expect(res.body.output_path).toBe(src)
    expect(fs.existsSync(src)).toBe(true)

    // Temp and backup files must be cleaned up
    const base = src.replace(/\.[^.]+$/, '')
    expect(fs.existsSync(`${base}_temp.mp4`)).toBe(false)
    expect(fs.existsSync(`${src}.bak`)).toBe(false)

    expect(probeDuration(src)).toBeGreaterThan(0)
  })
})

// ── GET /api/video/waveform ───────────────────────────────────────────────────
//
// The waveform endpoint now signals cache misses instead of generating peaks
// inline. Clients receive { status: 'miss', duration } and fetch peaks via
// /api/video/waveform/chunk. Actual peak generation is tested in the chunk
// describe block below.

describe('GET /api/video/waveform — real ffmpeg', () => {
  it('signals cache miss with duration for a video with audio', async () => {
    const src = path.join(obsDir, 'waveform-audio.mp4')
    fs.copyFileSync(fixtureAudioMp4, src)

    const res = await request(server).get(
      `/api/video/waveform?path=${encodeURIComponent(src)}&track=0`
    )

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('miss')
    expect(typeof res.body.duration).toBe('number')
    expect(res.body.duration).toBeGreaterThan(0)
  })

  it('signals cache miss with duration for a video-only file', async () => {
    // Video-only files have a video-stream duration even with no audio track,
    // so the endpoint returns { status: 'miss', duration } rather than { peaks: [] }.
    const src = path.join(obsDir, 'waveform-silent.mp4')
    fs.copyFileSync(fixtureSilentMp4, src)

    const res = await request(server).get(
      `/api/video/waveform?path=${encodeURIComponent(src)}&track=0`
    )

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('miss')
    expect(typeof res.body.duration).toBe('number')
    expect(res.body.duration).toBeGreaterThan(0)
  })
})

// ── GET /api/video/waveform/chunk ────────────────────────────────────────────

describe('GET /api/video/waveform/chunk — real ffmpeg', () => {
  it('returns peaks for a chunk of a video with audio', async () => {
    const src = path.join(obsDir, 'waveform-chunk-audio.mp4')
    fs.copyFileSync(fixtureAudioMp4, src)

    // Get duration from the waveform endpoint
    const missRes = await request(server).get(
      `/api/video/waveform?path=${encodeURIComponent(src)}&track=0`
    )
    const totalDuration = missRes.body.duration

    const res = await request(server).get(
      `/api/video/waveform/chunk?path=${encodeURIComponent(src)}&track=0&start=0&end=${totalDuration}&totalDuration=${totalDuration}`
    )

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.peaks)).toBe(true)
    expect(res.body.peaks.length).toBeGreaterThan(0)
    expect(res.body.startTime).toBe(0)
    expect(res.body.endTime).toBe(totalDuration)
  })

  it('returns different peak counts for different resolutions', async () => {
    const src = path.join(obsDir, 'waveform-chunk-res.mp4')
    fs.copyFileSync(fixtureAudioMp4, src)

    const missRes = await request(server).get(
      `/api/video/waveform?path=${encodeURIComponent(src)}&track=0`
    )
    const totalDuration = missRes.body.duration

    const params = `path=${encodeURIComponent(src)}&track=0&start=0&end=${totalDuration}&totalDuration=${totalDuration}`
    const lowRes = await request(server).get(`/api/video/waveform/chunk?${params}&resolution=low`)
    const defaultRes = await request(server).get(`/api/video/waveform/chunk?${params}&resolution=default`)
    const highRes = await request(server).get(`/api/video/waveform/chunk?${params}&resolution=high`)

    expect(lowRes.status).toBe(200)
    expect(defaultRes.status).toBe(200)
    expect(highRes.status).toBe(200)

    // Different resolutions should produce different peak counts
    expect(lowRes.body.peaks.length).toBeLessThan(defaultRes.body.peaks.length)
    expect(defaultRes.body.peaks.length).toBeLessThan(highRes.body.peaks.length)

    // Approximate peak counts for the ~3 sec fixture video
    expect(lowRes.body.peaks.length).toBeGreaterThan(500)    // ~1000 peaks total
    expect(defaultRes.body.peaks.length).toBeGreaterThan(1000) // ~2000 peaks total
    expect(highRes.body.peaks.length).toBeGreaterThan(2000)  // ~4000 peaks total
  })

  it('returns empty peaks for a video-only file (no audio stream at track 0)', async () => {
    const src = path.join(obsDir, 'waveform-chunk-silent.mp4')
    fs.copyFileSync(fixtureSilentMp4, src)

    const missRes = await request(server).get(
      `/api/video/waveform?path=${encodeURIComponent(src)}&track=0`
    )
    const totalDuration = missRes.body.duration

    const res = await request(server).get(
      `/api/video/waveform/chunk?path=${encodeURIComponent(src)}&track=0&start=0&end=${totalDuration}&totalDuration=${totalDuration}`
    )

    expect(res.status).toBe(200)
    // FFmpeg returns no samples for a track that doesn't exist → empty peaks
    expect(Array.isArray(res.body.peaks)).toBe(true)
    expect(res.body.peaks).toHaveLength(0)
  })
})

// ── GET /api/video/tracks ─────────────────────────────────────────────────────

describe('GET /api/video/tracks — real ffprobe', () => {
  it('returns audio track info for a video with an audio stream', async () => {
    const src = path.join(destDir, 'tracks-audio.mp4')
    fs.copyFileSync(fixtureAudioMp4, src)

    const res = await request(server).get(`/api/video/tracks?path=${encodeURIComponent(src)}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.tracks)).toBe(true)
    expect(res.body.tracks.length).toBeGreaterThan(0)
    const track = res.body.tracks[0]
    expect(track).toHaveProperty('index')
    expect(track).toHaveProperty('codec_name')
    expect(track.codec_name).toBe('aac')
  })

  it('returns empty tracks array for a video-only file', async () => {
    const src = path.join(destDir, 'tracks-silent.mp4')
    fs.copyFileSync(fixtureSilentMp4, src)

    const res = await request(server).get(`/api/video/tracks?path=${encodeURIComponent(src)}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.tracks)).toBe(true)
    expect(res.body.tracks).toHaveLength(0)
  })
})
