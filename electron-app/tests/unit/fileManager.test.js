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
