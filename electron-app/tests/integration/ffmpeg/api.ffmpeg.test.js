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
const ffmpegPath  = _req('ffmpeg-static')
const ffprobePath = _req('ffprobe-static').path

// ── Probe helpers ─────────────────────────────────────────────────────────────

function probeDuration(filePath) {
  const out = execFileSync(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf-8', timeout: 10_000 })
  return parseFloat(out.trim())
}

function probeVideoCodec(filePath) {
  const out = execFileSync(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf-8', timeout: 10_000 })
  return out.trim()
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

let fixtureSilentMp4   // 3-second MP4, no audio track (clips & reencode tests)
let fixtureAudioMp4    // 3-second MP4, video + 440 Hz sine audio (waveform & tracks tests)

beforeAll(() => {
  const tmp = os.tmpdir()
  fixtureSilentMp4 = path.join(tmp, 'openclip-api-silent.mp4')
  fixtureAudioMp4  = path.join(tmp, 'openclip-api-audio.mp4')

  // Silent video — stream-copy-safe for clip extraction
  execFileSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=3:size=32x32:rate=1',
    '-c:v', 'libx264', '-crf', '51', '-preset', 'ultrafast', '-an',
    fixtureSilentMp4,
  ], { timeout: 30_000 })

  // Video + audio — required for waveform and track-detection tests
  execFileSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=3:size=32x32:rate=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-crf', '51', '-preset', 'ultrafast',
    '-c:a', 'aac', '-b:a', '32k',
    fixtureAudioMp4,
  ], { timeout: 30_000 })
}, 60_000)

afterAll(() => {
  try { fs.unlinkSync(fixtureSilentMp4) } catch {}
  try { fs.unlinkSync(fixtureAudioMp4) } catch {}
})

// ── Shared server — one per test file (avoids module-level store conflicts) ────

let server, store, tmpDir, obsDir, destDir

beforeAll(async () => {
  tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-api-ffmpeg-'))
  obsDir  = path.join(tmpDir, 'obs')
  destDir = path.join(tmpDir, 'dest')
  fs.mkdirSync(obsDir,  { recursive: true })
  fs.mkdirSync(destDir, { recursive: true })

  store  = makeStore(obsDir, destDir)
  const { startApiServer } = await import('../../../electron/apiServer.js')
  server = startApiServer(store)
  await new Promise(resolve => server.on('listening', resolve))
}, 10_000)

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Remove any clips produced by the previous test so clip counters reset
  const clipsDir = path.join(destDir, 'Clips')
  if (fs.existsSync(clipsDir)) {
    for (const f of fs.readdirSync(clipsDir)) {
      try { fs.rmSync(path.join(clipsDir, f), { force: true }) } catch {}
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

    const clipsDir = path.join(destDir, 'Clips')
    const clips = fs.readdirSync(clipsDir).filter(f => f.endsWith('.mp4'))
    expect(clips).toHaveLength(1)

    const duration = probeDuration(path.join(clipsDir, clips[0]))
    expect(duration).toBeGreaterThan(0)
    expect(duration).toBeLessThan(3)   // requested 1.5 s; allow rounding
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
      .send({ source_path: src, codec: 'h264', crf: 51, preset: 'ultrafast', replace_original: true })

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

describe('GET /api/video/waveform — real ffmpeg', () => {
  it('returns a non-empty peaks array for a video with audio', async () => {
    const src = path.join(obsDir, 'waveform-audio.mp4')
    fs.copyFileSync(fixtureAudioMp4, src)

    const res = await request(server)
      .get(`/api/video/waveform?path=${encodeURIComponent(src)}&track=0`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.peaks)).toBe(true)
    expect(res.body.peaks.length).toBeGreaterThan(0)
    expect(typeof res.body.duration).toBe('number')
    expect(res.body.duration).toBeGreaterThan(0)
  })

  it('returns empty peaks for a video with no audio track', async () => {
    const src = path.join(obsDir, 'waveform-silent.mp4')
    fs.copyFileSync(fixtureSilentMp4, src)

    const res = await request(server)
      .get(`/api/video/waveform?path=${encodeURIComponent(src)}&track=0`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.peaks)).toBe(true)
    expect(res.body.peaks).toHaveLength(0)
  })
})

// ── GET /api/video/tracks ─────────────────────────────────────────────────────

describe('GET /api/video/tracks — real ffprobe', () => {
  it('returns audio track info for a video with an audio stream', async () => {
    const src = path.join(destDir, 'tracks-audio.mp4')
    fs.copyFileSync(fixtureAudioMp4, src)

    const res = await request(server)
      .get(`/api/video/tracks?path=${encodeURIComponent(src)}`)

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

    const res = await request(server)
      .get(`/api/video/tracks?path=${encodeURIComponent(src)}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.tracks)).toBe(true)
    expect(res.body.tracks).toHaveLength(0)
  })
})
