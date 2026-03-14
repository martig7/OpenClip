/**
 * ffmpeg integration tests for fileManager.js
 *
 * Uses real ffmpeg/ffprobe binaries (from ffmpeg-static/ffprobe-static).
 * child_process is NOT mocked — execFileAsync calls actually run.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createRequire } from 'module'

const _req = createRequire(import.meta.url)
const ffmpegPath = _req('ffmpeg-static')
const ffprobePath = _req('ffprobe-static').path

// ── Fixture generation ───────────────────────────────────────────────────────

let fixtureMkv   // path to a real, valid MKV generated once for the whole suite

beforeAll(() => {
  fixtureMkv = path.join(os.tmpdir(), 'openclip-ffmpeg-fixture.mkv')
  // 1-second, 32×32 silent video — the smallest valid MKV ffmpeg can produce
  execFileSync(ffmpegPath, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=1:size=32x32:rate=1',
    '-c:v', 'libx264', '-crf', '51', '-preset', 'ultrafast', '-an',
    fixtureMkv,
  ], { timeout: 20_000 })
})

afterAll(() => {
  try { fs.unlinkSync(fixtureMkv) } catch {}
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(obsDir, destDir) {
  const data = {
    settings: { obsRecordingPath: obsDir, destinationPath: destDir, autoClip: null },
  }
  return {
    get: (key) => key.split('.').reduce((o, k) => o?.[k], data),
    set: () => {},
    _data: data,
  }
}

function probeDuration(filePath) {
  const out = execFileSync(ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf-8', timeout: 10_000 })
  return parseFloat(out.trim())
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('organizeRecordings — real ffmpeg', () => {
  let tmpDir, obsDir, destDir, store

  beforeEach(() => {
    tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-ffmpeg-'))
    obsDir  = path.join(tmpDir, 'obs')
    destDir = path.join(tmpDir, 'dest')
    fs.mkdirSync(obsDir,  { recursive: true })
    fs.mkdirSync(destDir, { recursive: true })
    store = makeStore(obsDir, destDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('remuxes a real MKV into a valid MP4 in the dest week folder', async () => {
    // Copy fixture into obsDir so organizeRecordings sees a fresh file
    const src = path.join(obsDir, 'game-session.mkv')
    fs.copyFileSync(fixtureMkv, src)

    const { organizeRecordings } = await import('../../../electron/fileManager.js')
    await organizeRecordings(store, 'TestGame')

    // Original MKV must be gone
    expect(fs.existsSync(src)).toBe(false)

    // A week folder must have been created under destDir
    const weekDirs = fs.readdirSync(destDir)
    expect(weekDirs).toHaveLength(1)
    const weekDir = path.join(destDir, weekDirs[0])

    // Exactly one MP4 should exist in it
    const mp4s = fs.readdirSync(weekDir).filter(f => f.endsWith('.mp4'))
    expect(mp4s).toHaveLength(1)
    expect(mp4s[0]).toMatch(/^TestGame Session \d{4}-\d{2}-\d{2} #1\.mp4$/)

    // ffprobe must report a positive duration — proves the file is a valid video
    const duration = probeDuration(path.join(weekDir, mp4s[0]))
    expect(duration).toBeGreaterThan(0)
  })

  it('corrupt MKV remux failure: no partial MP4 left, original file kept', async () => {
    // A file with .mkv extension but containing garbage — ffmpeg will reject it
    const src = path.join(obsDir, 'corrupt-session.mkv')
    fs.writeFileSync(src, Buffer.alloc(1024, 0x42))

    const { organizeRecordings } = await import('../../../electron/fileManager.js')
    await organizeRecordings(store, 'TestGame')

    // No .mp4 files anywhere in destDir
    const weekDirs = fs.readdirSync(destDir)
    for (const dir of weekDirs) {
      const mp4s = fs.readdirSync(path.join(destDir, dir)).filter(f => f.endsWith('.mp4'))
      expect(mp4s).toHaveLength(0)
    }

    // Original must still be accessible — either renamed to the week dir (.mkv)
    // or still in obsDir if the rename itself also failed
    const inObs = fs.existsSync(src)
    const inDest = weekDirs.some(dir =>
      fs.readdirSync(path.join(destDir, dir)).some(f => f.endsWith('.mkv'))
    )
    expect(inObs || inDest).toBe(true)
  })
})
