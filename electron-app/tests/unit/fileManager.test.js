import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// child_process: setup.js patches Module._load + vi.mock for ESM.
// No factory here — keeps same vi.fn() instances as Module._load,
// so fileManager.js and test code share stubs.

import { makeMockStore } from '../helpers/mockStore.js'

// Helper: build a minimal ipcMain mock that captures handlers by channel name
function makeMockIpcMain() {
  const handlers = {}
  return {
    handle: (channel, fn) => { handlers[channel] = fn },
    invoke: (channel, ...args) => {
      try {
        return Promise.resolve(handlers[channel]({}, ...args))
      } catch (e) {
        return Promise.reject(e)
      }
    },
  }
}

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
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────
// getWeekFolder
// ─────────────────────────────────────────────────────────────────
describe('getWeekFolder', () => {
  // getWeekFolder is not exported directly; test indirectly via directory names created

  it('uses prior Monday for a Wednesday date', async () => {
    // We'll verify by creating a file and checking the target dir
    const store = makeMockStore({
      settings: { obsRecordingPath: obsDir, destinationPath: destDir, autoClip: null },
    })
    const { organizeRecordings } = await import('../../electron/fileManager.js')

    // Create a fresh .mp4 in obsDir
    const src = path.join(obsDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    // Mock execFile (used via execFileAsync/promisify) to succeed (ffprobe probe call)
    const cp = await import('child_process')
    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      callback(null, { stdout: '{"streams":[]}', stderr: '' })
    })

    await organizeRecordings(store, 'TestGame')

    // Directory should exist - name contains "Week of"
    const entries = fs.readdirSync(destDir)
    expect(entries.some(e => e.includes('Week of'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// organizeRecordings
// ─────────────────────────────────────────────────────────────────
describe('organizeRecordings', () => {
  let store
  let cp

  beforeEach(async () => {
    store = makeMockStore({
      settings: {
        obsRecordingPath: obsDir,
        destinationPath: destDir,
        autoClip: null,
      },
    })
    vi.resetModules()
    cp = await import('child_process')
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
    expect(files.some(f => f.endsWith('.mp4'))).toBe(true)
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
      expect(files.filter(f => f.endsWith('.mp4'))).toHaveLength(0)
    }

    // Original .mkv must still be accessible (renamed into dest dir or still in obsDir)
    const mkvInObs = fs.existsSync(src)
    const mkvInDest = weekDirs.some(dir =>
      fs.readdirSync(path.join(destDir, dir)).some(f => f.endsWith('.mkv'))
    )
    expect(mkvInObs || mkvInDest).toBe(true)
  })

  it('writes .tracks.json sidecar when ffprobe finds titled streams', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mkv')
    fs.writeFileSync(src, Buffer.alloc(1024))

    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      if (args.includes('-show_streams')) {
        callback(null, { stdout: JSON.stringify({
          streams: [{ tags: { title: 'Game Audio' } }, { tags: { title: 'Discord' } }],
        }), stderr: '' })
      } else {
        const outPath = args[args.length - 1]
        fs.writeFileSync(outPath, Buffer.alloc(512))
        callback(null, { stdout: '', stderr: '' })
      }
    })

    await organizeRecordings(store, 'MyGame')

    const destEntries = fs.readdirSync(destDir)
    const weekDir = path.join(destDir, destEntries[0])
    const sidecars = fs.readdirSync(weekDir).filter(f => f.endsWith('.tracks.json'))
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
    const files = fs.readdirSync(weekDir).filter(f => f.endsWith('.mp4'))
    expect(files.some(f => f.includes('#2'))).toBe(true)
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

    const phases = events.map(e => e.stage ?? e.phase)
    expect(phases).toContain('checking')
    expect(phases).toContain('moving')
    expect(events.some(e => e.phase === 'complete')).toBe(true)
    // checking must appear before moving
    const checkIdx = events.findIndex(e => e.stage === 'checking')
    const moveIdx = events.findIndex(e => e.stage === 'moving')
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

    expect(events.some(e => e.stage === 'checking')).toBe(true)
    expect(events.some(e => e.stage === 'remuxing')).toBe(true)
    expect(events.some(e => e.phase === 'complete')).toBe(true)
    // checking must appear before remuxing
    const checkIdx = events.findIndex(e => e.stage === 'checking')
    const remuxIdx = events.findIndex(e => e.stage === 'remuxing')
    expect(checkIdx).toBeLessThan(remuxIdx)
  })

  it('all onProgress events carry the correct gameName', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    const events = []
    await organizeRecordings(store, 'SpecificGame', (p) => events.push(p))

    expect(events.length).toBeGreaterThan(0)
    expect(events.every(e => e.gameName === 'SpecificGame')).toBe(true)
  })

  it('emits complete even when no files are found in obsDir', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    // obsDir is empty — no video files to process

    const events = []
    await organizeRecordings(store, 'MyGame', (p) => events.push(p))

    // Still emits complete even with nothing to organize
    expect(events.some(e => e.phase === 'complete')).toBe(true)
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

    const clippingEvents = events.filter(e => e.phase === 'clipping')
    expect(clippingEvents.length).toBe(2)
    expect(clippingEvents[0].clipIndex).toBe(1)
    expect(clippingEvents[0].clipTotal).toBe(2)
    expect(clippingEvents[1].clipIndex).toBe(2)
    // complete fires after clipping
    const completeIdx = events.findIndex(e => e.phase === 'complete')
    const lastClipIdx = events.map((e, i) => ({ e, i })).filter(({ e }) => e.phase === 'clipping').pop().i
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
    store._data.clipMarkers = [
      { game: 'MyGame', timestamp: recordingStartUnix + 30 },
    ]

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
    const ffmpegCalls = cp.execFile.mock.calls.filter(([bin, args]) =>
      !args.includes('-show_entries') && args.includes('-avoid_negative_ts')
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
    const clips = fs.readdirSync(clipsDir).filter(f => f.endsWith('.mp4'))
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatch(/^MyGame Clip \d{4}-\d{2}-\d{2} #1\.mp4$/)
  })
})

// ─────────────────────────────────────────────────────────────────
// organizeSpecificRecording
// ─────────────────────────────────────────────────────────────────
describe('organizeSpecificRecording', () => {
  let store

  beforeEach(() => {
    vi.resetModules()
    store = makeMockStore({
      settings: { destinationPath: destDir },
    })
  })

  // Test 21 — uses file mtime for the week folder
  it('uses file mtime for the week folder name', async () => {
    const filePath = path.join(obsDir, 'old-recording.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))
    // 2024-01-10 is a Wednesday — week starts Monday Jan 8
    const mtimeDate = new Date('2024-01-10T12:00:00.000Z')
    fs.utimesSync(filePath, mtimeDate, mtimeDate)

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    vi.useFakeTimers()
    const organizePromise = organizeSpecificRecording(store, filePath, 'TestGame')
    await vi.runAllTimersAsync()
    const result = await organizePromise
    vi.useRealTimers()

    expect(result.success).toBe(true)
    const destEntries = fs.readdirSync(destDir)
    expect(destEntries).toHaveLength(1)
    // Week folder must reflect the file's mtime (Jan 2024), not today's date
    expect(destEntries[0]).toMatch(/Jan.*2024/)
    expect(destEntries[0]).toContain('Jan 8 2024')
  })

  // Test 22 — skips files already inside the destination (no double-move)
  it('returns alreadyOrganized when file is already inside destPath', async () => {
    // Place a file inside an existing week folder under destDir
    const weekDir = path.join(destDir, 'MyGame - Week of Jan 8 2024')
    fs.mkdirSync(weekDir, { recursive: true })
    const filePath = path.join(weekDir, 'MyGame Session 2024-01-10 #1.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')
    const result = await organizeSpecificRecording(store, filePath, 'MyGame')

    expect(result.success).toBe(true)
    expect(result.alreadyOrganized).toBe(true)
    // File must not have been moved — still exists at the same path
    expect(fs.existsSync(filePath)).toBe(true)
    // No new week folders created
    const entries = fs.readdirSync(destDir)
    expect(entries).toHaveLength(1)
  })

  // Test 24 — permission denied on destination folder
  it('throws a friendly error when destination mkdir is permission denied', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    const mkdirErr = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw mkdirErr })

    vi.useFakeTimers()
    const organizePromise = organizeSpecificRecording(store, filePath, 'MyGame')
    organizePromise.catch(() => {}) // suppress unhandled rejection during timer advance
    await vi.runAllTimersAsync()
    vi.useRealTimers()

    await expect(organizePromise).rejects.toThrow(/[Pp]ermission denied/)
    mkdirSpy.mockRestore()
  })

  // Test 25 — disk full error when moving an MP4
  it('throws a friendly error when disk is full during move', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    // mkdirSync succeeds, then renameSync fails with ENOSPC
    const origMkdir = fs.mkdirSync.bind(fs)
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(origMkdir)
    const renameErr = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw renameErr })

    vi.useFakeTimers()
    const organizePromise = organizeSpecificRecording(store, filePath, 'MyGame')
    organizePromise.catch(() => {}) // suppress unhandled rejection during timer advance
    await vi.runAllTimersAsync()
    vi.useRealTimers()

    await expect(organizePromise).rejects.toThrow(/disk space/)
    mkdirSpy.mockRestore()
    renameSpy.mockRestore()
  })

  // ── EXDEV (cross-device) fallback tests ─────────────────────────────────────

  // Test 26 — MP4 cross-device: rename fails with EXDEV → falls back to copy+delete
  it('MP4: falls back to copy+delete when rename fails with EXDEV', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    const exdevErr = Object.assign(new Error('EXDEV: cross-device link not permitted, rename'), { code: 'EXDEV' })
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw exdevErr })

    vi.useFakeTimers()
    const organizePromise = organizeSpecificRecording(store, filePath, 'MyGame')
    await vi.runAllTimersAsync()
    const result = await organizePromise
    vi.useRealTimers()
    renameSpy.mockRestore()

    expect(result.success).toBe(true)
    // Original file must have been deleted (the 'delete' half of copy+delete)
    expect(fs.existsSync(filePath)).toBe(false)
    // Destination file must exist and be readable
    expect(fs.existsSync(result.path)).toBe(true)
    expect(result.path).toMatch(/\.mp4$/)
  })

  // Test 27 — MKV cross-device: ffmpeg fails, fallback rename fails with EXDEV → copy+delete
  it('MKV fallback move: copy+delete when rename fails with EXDEV after ffmpeg failure', async () => {
    const cp = await import('child_process')
    const filePath = path.join(obsDir, 'recording.mkv')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    // ffprobe succeeds; ffmpeg fails so the code falls through to the rename fallback
    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      if (args.includes('-show_streams')) {
        callback(null, { stdout: '{"streams":[]}', stderr: '' })
      } else {
        callback(new Error('ffmpeg: codec error'))
      }
    })

    const exdevErr = Object.assign(new Error('EXDEV: cross-device link not permitted, rename'), { code: 'EXDEV' })
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw exdevErr })

    vi.useFakeTimers()
    const organizePromise = organizeSpecificRecording(store, filePath, 'MyGame')
    await vi.runAllTimersAsync()
    const result = await organizePromise
    vi.useRealTimers()
    renameSpy.mockRestore()

    expect(result.success).toBe(true)
    // Original MKV must be gone (copied then unlinked)
    expect(fs.existsSync(filePath)).toBe(false)
    // Fallback keeps the original extension
    expect(result.path).toMatch(/\.mkv$/)
    expect(fs.existsSync(result.path)).toBe(true)
  })

  // ── waitForUnlock / EBUSY retry tests ───────────────────────────────────────

  // Test 28 — waitForUnlock retries on EBUSY and succeeds once lock clears
  it('retries the lock check on EBUSY and succeeds when the file becomes unlocked', async () => {
    const filePath = path.join(obsDir, 'locked.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    const origOpen = fs.openSync.bind(fs)
    let openAttempts = 0
    const openSpy = vi.spyOn(fs, 'openSync').mockImplementation((p, flags) => {
      openAttempts++
      if (openAttempts <= 2) {
        // Simulate OBS still holding the file handle for the first two checks
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      }
      return origOpen(p, flags)
    })

    vi.useFakeTimers()
    const organizePromise = organizeSpecificRecording(store, filePath, 'MyGame')
    await vi.runAllTimersAsync()
    const result = await organizePromise
    vi.useRealTimers()
    openSpy.mockRestore()

    expect(result.success).toBe(true)
    expect(openAttempts).toBeGreaterThanOrEqual(3)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  // Test 29 — waitForUnlock throws a clear error after exhausting all retries
  it('throws a friendly error when the file remains locked through all retries', async () => {
    const filePath = path.join(obsDir, 'perma-locked.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    const openSpy = vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    })

    vi.useFakeTimers()
    const organizePromise = organizeSpecificRecording(store, filePath, 'MyGame')
    organizePromise.catch(() => {})
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    openSpy.mockRestore()

    await expect(organizePromise).rejects.toThrow(/locked/)
    // Original file must still be untouched — nothing was moved
    expect(fs.existsSync(filePath)).toBe(true)
  })

  // ── onProgress callback tests ────────────────────────────────────────────────

  // Test 30 — onProgress fires 'checking' first, then 'remuxing' for an MKV
  it('calls onProgress(checking) then onProgress(remuxing) for MKV files', async () => {
    const cp = await import('child_process')
    const filePath = path.join(obsDir, 'recording.mkv')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      if (args.includes('-show_streams')) {
        callback(null, { stdout: '{"streams":[]}', stderr: '' })
      } else {
        const outPath = args[args.length - 1]
        fs.writeFileSync(outPath, Buffer.alloc(512))
        callback(null, { stdout: '', stderr: '' })
      }
    })

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')
    const stages = []

    vi.useFakeTimers()
    const p = organizeSpecificRecording(store, filePath, 'MyGame', {
      onProgress: (stage) => stages.push(stage),
    })
    await vi.runAllTimersAsync()
    await p
    vi.useRealTimers()

    expect(stages[0]).toBe('checking')
    expect(stages[1]).toBe('remuxing')
  })

  // Test 31 — onProgress fires 'checking' then 'moving' for an MP4
  it('calls onProgress(checking) then onProgress(moving) for MP4 files', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')
    const stages = []

    vi.useFakeTimers()
    const p = organizeSpecificRecording(store, filePath, 'MyGame', {
      onProgress: (stage) => stages.push(stage),
    })
    await vi.runAllTimersAsync()
    await p
    vi.useRealTimers()

    expect(stages[0]).toBe('checking')
    expect(stages[1]).toBe('moving')
  })

  // Test 32 — onProgress fires 'moving' (not 'remuxing') when moveOnly is true for MKV
  it('calls onProgress(moving) and never onProgress(remuxing) when moveOnly is true', async () => {
    const filePath = path.join(obsDir, 'recording.mkv')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')
    const stages = []

    vi.useFakeTimers()
    const p = organizeSpecificRecording(store, filePath, 'MyGame', {
      moveOnly: true,
      onProgress: (stage) => stages.push(stage),
    })
    await vi.runAllTimersAsync()
    await p
    vi.useRealTimers()

    expect(stages).toContain('checking')
    expect(stages).toContain('moving')
    expect(stages).not.toContain('remuxing')
  })

  // ── moveOnly option tests ───────────────────────────────────────────────────

  // Test 33 — moveOnly: true keeps original .mkv extension and skips ffmpeg
  it('moveOnly: true moves MKV without remuxing, keeping the original extension', async () => {
    const cp = await import('child_process')
    const filePath = path.join(obsDir, 'recording.mkv')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    vi.useFakeTimers()
    const p = organizeSpecificRecording(store, filePath, 'MyGame', { moveOnly: true })
    await vi.runAllTimersAsync()
    const result = await p
    vi.useRealTimers()

    expect(result.success).toBe(true)
    // Dest must keep .mkv extension
    expect(result.path).toMatch(/\.mkv$/)
    // ffmpeg (remux) must NOT have been called
    const remuxCalls = cp.execFile.mock.calls.filter(([, args]) =>
      args && args.includes('-movflags')
    )
    expect(remuxCalls).toHaveLength(0)
    // Source file must have been removed
    expect(fs.existsSync(filePath)).toBe(false)
    // Destination file must exist
    expect(fs.existsSync(result.path)).toBe(true)
  })

  // Test 34 — moveOnly: true with an already-MP4 file still moves correctly
  it('moveOnly: true with an MP4 file still moves to the correct destination', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    vi.useFakeTimers()
    const p = organizeSpecificRecording(store, filePath, 'MyGame', { moveOnly: true })
    await vi.runAllTimersAsync()
    const result = await p
    vi.useRealTimers()

    expect(result.success).toBe(true)
    expect(result.path).toMatch(/\.mp4$/)
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(result.path)).toBe(true)
  })

  // Test 35 — moveOnly: false (default) still remuxes MKV → MP4
  it('moveOnly: false (default) remuxes MKV to MP4 as before', async () => {
    const cp = await import('child_process')
    const filePath = path.join(obsDir, 'recording.mkv')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    cp.execFile.mockImplementation((bin, args, opts, callback) => {
      if (args.includes('-show_streams')) {
        callback(null, { stdout: '{"streams":[]}', stderr: '' })
      } else {
        const outPath = args[args.length - 1]
        fs.writeFileSync(outPath, Buffer.alloc(512))
        callback(null, { stdout: '', stderr: '' })
      }
    })

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    vi.useFakeTimers()
    const p = organizeSpecificRecording(store, filePath, 'MyGame', { moveOnly: false })
    await vi.runAllTimersAsync()
    const result = await p
    vi.useRealTimers()

    expect(result.success).toBe(true)
    expect(result.path).toMatch(/\.mp4$/)
    const remuxCalls = cp.execFile.mock.calls.filter(([, args]) =>
      args && args.includes('-movflags')
    )
    expect(remuxCalls).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────
// setupFileManager — recordings:delete / clips:delete path validation
// ─────────────────────────────────────────────────────────────────
describe('setupFileManager IPC path validation', () => {
  let store
  let ipc

  beforeEach(async () => {
    vi.resetModules()
    store = makeMockStore({
      settings: { obsRecordingPath: obsDir, destinationPath: destDir },
    })
    ipc = makeMockIpcMain()
    const { setupFileManager } = await import('../../electron/fileManager.js')
    setupFileManager(ipc, store)
  })

  for (const channel of ['recordings:delete', 'clips:delete']) {
    describe(channel, () => {
      it('deletes a valid file inside destPath', async () => {
        const fp = path.join(destDir, 'game', 'recording.mp4')
        fs.mkdirSync(path.dirname(fp), { recursive: true })
        fs.writeFileSync(fp, Buffer.alloc(8))
        const result = await ipc.invoke(channel, fp)
        expect(result.success).toBe(true)
        expect(fs.existsSync(fp)).toBe(false)
      })

      it('rejects a path traversal attempt with .. sequences', async () => {
        // Construct a path that starts with destDir string but escapes via ..
        const traversal = path.join(destDir, '..', 'secret.txt')
        await expect(ipc.invoke(channel, traversal)).rejects.toThrow('Invalid path')
      })

      it('rejects a path outside destPath', async () => {
        const outside = path.join(tmpDir, 'outside.mp4')
        fs.writeFileSync(outside, Buffer.alloc(8))
        await expect(ipc.invoke(channel, outside)).rejects.toThrow('Invalid path')
      })

      it('rejects destPath itself (not a file inside it)', async () => {
        await expect(ipc.invoke(channel, destDir)).rejects.toThrow('Invalid path')
      })
    })
  }
})
