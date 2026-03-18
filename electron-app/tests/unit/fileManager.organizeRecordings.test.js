import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

import { _cpMock as cp } from '../setup.js'
import { makeMockStore } from '../helpers/mockStore.js'

let tmpDir
let obsDir
let destDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-fm-'))
  obsDir = path.join(tmpDir, 'obs')
  destDir = path.join(tmpDir, 'dest')
  fs.mkdirSync(obsDir, { recursive: true })
  fs.mkdirSync(destDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.resetModules()
  vi.resetAllMocks()
})

// ─────────────────────────────────────────────────────────────
// organizeRecordings
// ─────────────────────────────────────────────────────────────
describe('organizeRecordings', () => {
  let store

  beforeEach(() => {
    store = makeMockStore({
      settings: {
        obsRecordingPath: obsDir,
        destinationPath: destDir,
        autoClip: null,
      },
    })
    vi.resetModules()
  })

  it('skips files older than 10 minutes', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'old.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))
    // Set mtime to 11 minutes ago
    const old = new Date(Date.now() - 11 * 60 * 1000)
    fs.utimesSync(src, old, old)

    await organizeRecordings(store, 'Game')

    // File should still be in obsDir
    expect(fs.existsSync(src)).toBe(true)
    expect(fs.readdirSync(destDir)).toHaveLength(0)
  })

  it('renames a fresh MP4 to session name in dest', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    await organizeRecordings(store, 'MyGame')

    const destEntries = fs.readdirSync(destDir)
    expect(destEntries).toHaveLength(1)
    const weekDir = path.join(destDir, destEntries[0])
    const files = fs.readdirSync(weekDir)
    expect(files[0]).toMatch(/^MyGame Session \d{4}-\d{2}-\d{2} #1\.mp4$/)
  })

  it('remuxes a fresh MKV to MP4', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mkv')
    fs.writeFileSync(src, Buffer.alloc(1024))

    // execFile is used via promisify (execFileAsync); mock its callback-style interface
    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      if (args.includes('-show_streams')) {
        callback(null, { stdout: '{"streams":[]}', stderr: '' })
      } else {
        // ffmpeg call — create the output file
        const outPath = args[args.length - 1]
        fs.writeFileSync(outPath, Buffer.alloc(512))
        callback(null, { stdout: '', stderr: '' })
      }
    })

    await organizeRecordings(store, 'MyGame')

    // Original MKV should be gone
    expect(fs.existsSync(src)).toBe(false)
    // Dest should have the MP4
    const destEntries = fs.readdirSync(destDir)
    const weekDir = path.join(destDir, destEntries[0])
    const files = fs.readdirSync(weekDir)
    expect(files.some((f) => f.endsWith('.mp4'))).toBe(true)
  })

  it('MKV remux failure cleans up partial MP4 and keeps the original file', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mkv')
    fs.writeFileSync(src, Buffer.alloc(1024))

    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      if (args.includes('-show_streams')) {
        // ffprobe probe succeeds
        callback(null, { stdout: '{"streams":[]}', stderr: '' })
      } else {
        // ffmpeg writes a partial output then errors
        const outPath = args[args.length - 1]
        fs.writeFileSync(outPath, Buffer.alloc(128))
        callback(new Error('ffmpeg: encoder error'))
      }
    })

    await organizeRecordings(store, 'MyGame')

    // No .mp4 should survive in dest — the partial output must have been deleted
    const weekDirs = fs.readdirSync(destDir)
    for (const dir of weekDirs) {
      const files = fs.readdirSync(path.join(destDir, dir))
      expect(files.filter((f) => f.endsWith('.mp4'))).toHaveLength(0)
    }

    // Original .mkv must still be accessible (renamed into dest dir or still in obsDir)
    const mkvInObs = fs.existsSync(src)
    const mkvInDest = weekDirs.some((dir) =>
      fs.readdirSync(path.join(destDir, dir)).some((f) => f.endsWith('.mkv'))
    )
    expect(mkvInObs || mkvInDest).toBe(true)
  })

  it('writes .tracks.json sidecar when ffprobe finds titled streams', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mkv')
    fs.writeFileSync(src, Buffer.alloc(1024))

    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      if (args.includes('-show_streams')) {
        callback(null, {
          stdout: JSON.stringify({
            streams: [{ tags: { title: 'Game Audio' } }, { tags: { title: 'Discord' } }],
          }),
          stderr: '',
        })
      } else {
        const outPath = args[args.length - 1]
        fs.writeFileSync(outPath, Buffer.alloc(512))
        callback(null, { stdout: '', stderr: '' })
      }
    })

    await organizeRecordings(store, 'MyGame')

    const destEntries = fs.readdirSync(destDir)
    const weekDir = path.join(destDir, destEntries[0])
    const sidecars = fs.readdirSync(weekDir).filter((f) => f.endsWith('.tracks.json'))
    expect(sidecars).toHaveLength(1)
    const names = JSON.parse(fs.readFileSync(path.join(weekDir, sidecars[0]), 'utf-8'))
    expect(names).toContain('Game Audio')
  })

  it('increments session number for duplicate dates', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const today = new Date().toISOString().slice(0, 10)

    // First file
    const src1 = path.join(obsDir, 'video1.mp4')
    fs.writeFileSync(src1, Buffer.alloc(1024))
    await organizeRecordings(store, 'MyGame')

    // Second file
    const src2 = path.join(obsDir, 'video2.mp4')
    fs.writeFileSync(src2, Buffer.alloc(1024))
    await organizeRecordings(store, 'MyGame')

    const destEntries = fs.readdirSync(destDir)
    const weekDir = path.join(destDir, destEntries[0])
    const files = fs.readdirSync(weekDir).filter((f) => f.endsWith('.mp4'))
    expect(files.some((f) => f.includes('#2'))).toBe(true)
  })

  it('calls processAutoClips when autoClip is enabled', async () => {
    store._data.settings.autoClip = {
      enabled: true,
      bufferBefore: 15,
      bufferAfter: 15,
      removeMarkers: false,
      deleteFullRecording: false,
    }
    store._data.clipMarkers = []

    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    // Should not throw even with empty markers
    await organizeRecordings(store, 'MyGame')
  })

  // ── onProgress callback tests ─────────────────────────────────────────────

  it('calls onProgress with checking then moving for a fresh MP4', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    const events = []
    await organizeRecordings(store, 'MyGame', (p) => events.push(p))

    const phases = events.map((e) => e.stage ?? e.phase)
    expect(phases).toContain('checking')
    expect(phases).toContain('moving')
    expect(events.some((e) => e.phase === 'complete')).toBe(true)
    // checking must appear before moving
    const checkIdx = events.findIndex((e) => e.stage === 'checking')
    const moveIdx = events.findIndex((e) => e.stage === 'moving')
    expect(checkIdx).toBeLessThan(moveIdx)
  })

  it('calls onProgress with checking then remuxing for a fresh MKV', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mkv')
    fs.writeFileSync(src, Buffer.alloc(1024))

    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      if (args.includes('-show_streams')) {
        callback(null, { stdout: '{"streams":[]}', stderr: '' })
      } else {
        const outPath = args[args.length - 1]
        fs.writeFileSync(outPath, Buffer.alloc(512))
        callback(null, { stdout: '', stderr: '' })
      }
    })

    const events = []
    await organizeRecordings(store, 'MyGame', (p) => events.push(p))

    expect(events.some((e) => e.stage === 'checking')).toBe(true)
    expect(events.some((e) => e.stage === 'remuxing')).toBe(true)
    expect(events.some((e) => e.phase === 'complete')).toBe(true)
    // checking must appear before remuxing
    const checkIdx = events.findIndex((e) => e.stage === 'checking')
    const remuxIdx = events.findIndex((e) => e.stage === 'remuxing')
    expect(checkIdx).toBeLessThan(remuxIdx)
  })

  it('all onProgress events carry the correct gameName', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    const events = []
    await organizeRecordings(store, 'SpecificGame', (p) => events.push(p))

    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.gameName === 'SpecificGame')).toBe(true)
  })

  it('emits complete even when no files are found in obsDir', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    // obsDir is empty — no video files to process

    const events = []
    await organizeRecordings(store, 'MyGame', (p) => events.push(p))

    // Still emits complete even with nothing to organize
    expect(events.some((e) => e.phase === 'complete')).toBe(true)
  })

  it('emits clipping events and complete when autoClip is enabled with markers', async () => {
    store._data.settings.autoClip = {
      enabled: true,
      bufferBefore: 5,
      bufferAfter: 5,
      removeMarkers: false,
      deleteFullRecording: false,
    }

    const recordingMtime = Date.now() / 1000
    const duration = 60
    const recordingStartUnix = recordingMtime - duration
    store._data.clipMarkers = [
      { game: 'MyGame', timestamp: recordingStartUnix + 20 },
      { game: 'MyGame', timestamp: recordingStartUnix + 40 },
    ]

    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      if (args.includes('-show_entries')) {
        callback(null, { stdout: `${duration}\n`, stderr: '' })
      } else {
        const outPath = args[args.length - 2]
        fs.writeFileSync(outPath, Buffer.alloc(256))
        callback(null, { stdout: '', stderr: '' })
      }
    })

    const events = []
    await organizeRecordings(store, 'MyGame', (p) => events.push(p))

    const clippingEvents = events.filter((e) => e.phase === 'clipping')
    expect(clippingEvents.length).toBe(2)
    expect(clippingEvents[0].clipIndex).toBe(1)
    expect(clippingEvents[0].clipTotal).toBe(2)
    expect(clippingEvents[1].clipIndex).toBe(2)
    // complete fires after clipping
    const completeIdx = events.findIndex((e) => e.phase === 'complete')
    const lastClipIdx = events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.phase === 'clipping')
      .pop().i
    expect(completeIdx).toBeGreaterThan(lastClipIdx)
  })

  it('processAutoClips uses execFileAsync (not execSync) to extract clips', async () => {
    const autoClip = {
      enabled: true,
      bufferBefore: 5,
      bufferAfter: 5,
      removeMarkers: false,
      deleteFullRecording: false,
    }
    store._data.settings.autoClip = autoClip

    // Simulate a marker 30 seconds into the recording for 'MyGame'
    const recordingMtime = Date.now() / 1000
    const duration = 60
    const recordingStartUnix = recordingMtime - duration
    store._data.clipMarkers = [{ game: 'MyGame', timestamp: recordingStartUnix + 30 }]

    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mp4')
    const srcBuf = Buffer.alloc(1024)
    fs.writeFileSync(src, srcBuf)

    // Mock execFile: handle ffprobe duration probe and ffmpeg clip extraction
    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      if (args.includes('-show_entries')) {
        // ffprobe duration query — return 60 seconds
        callback(null, { stdout: `${duration}\n`, stderr: '' })
      } else {
        // ffmpeg clip extraction — create the output file
        const outPath = args[args.length - 2] // second-to-last arg is clipPath ('-y' is last)
        fs.writeFileSync(outPath, Buffer.alloc(256))
        callback(null, { stdout: '', stderr: '' })
      }
    })

    await organizeRecordings(store, 'MyGame')

    // Verify execFile was called with ffmpeg clip-extraction args (not execSync)
    const ffmpegCalls = cp.execFile.mock.calls.filter(
      ([bin, args]) => !args.includes('-show_entries') && args.includes('-avoid_negative_ts')
    )
    expect(ffmpegCalls).toHaveLength(1)
    const [, clipArgs] = ffmpegCalls[0]
    expect(clipArgs).toContain('-ss')
    expect(clipArgs).toContain('-t')
    expect(clipArgs).toContain('-c')
    expect(clipArgs).toContain('copy')
    expect(clipArgs).toContain('-y')

    // Verify a clip was created in destDir/Clips
    const clipsDir = path.join(destDir, 'Clips')
    expect(fs.existsSync(clipsDir)).toBe(true)
    const clips = fs.readdirSync(clipsDir).filter((f) => f.endsWith('.mp4'))
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatch(/^MyGame Clip \d{4}-\d{2}-\d{2} #1\.mp4$/)
  })
})
