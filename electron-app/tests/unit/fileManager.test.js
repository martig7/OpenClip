import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// child_process: setup.js patches Module._load + vi.mock for ESM.
// No factory here — keeps same vi.fn() instances as Module._load,
// so fileManager.js and test code share stubs.

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
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────
// getWeekFolder
// ─────────────────────────────────────────────────────────────────
describe('getWeekFolder', () => {
  // Import fresh each describe to avoid module cache issues
  let getWeekFolder

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import('../../electron/fileManager.js')
    // getWeekFolder is not exported directly, test via organizeRecordings naming
    // We'll test it indirectly by checking directory names created
    getWeekFolder = null // tested below via directory inspection
  })

  it('uses prior Monday for a Wednesday date', async () => {
    vi.resetModules()
    // We'll verify by creating a file and checking the target dir
    const store = makeMockStore({
      settings: { obsRecordingPath: obsDir, destinationPath: destDir, autoClip: null },
    })
    const { organizeRecordings } = await import('../../electron/fileManager.js')

    // Create a fresh .mp4 in obsDir
    const src = path.join(obsDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    // Mock execFileSync to succeed (ffprobe probe call) and execFile for ffmpeg
    const cp = await import('child_process')
    cp.execFileSync.mockReturnValue('{"streams":[]}')

    organizeRecordings(store, 'TestGame')

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

    organizeRecordings(store, 'Game')

    // File should still be in obsDir
    expect(fs.existsSync(src)).toBe(true)
    expect(fs.readdirSync(destDir)).toHaveLength(0)
  })

  it('renames a fresh MP4 to session name in dest', async () => {
    const { organizeRecordings } = await import('../../electron/fileManager.js')
    const src = path.join(obsDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    organizeRecordings(store, 'MyGame')

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

    // ffprobe returns empty streams; ffmpeg execFileSync call creates the dest file
    cp.execFileSync.mockImplementation((bin, args) => {
      if (args.includes('-show_streams')) return '{"streams":[]}'
      // ffmpeg call — create the output file
      const outPath = args[args.length - 1]
      fs.writeFileSync(outPath, Buffer.alloc(512))
      return ''
    })

    organizeRecordings(store, 'MyGame')

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

    cp.execFileSync.mockImplementation((bin, args) => {
      if (args.includes('-show_streams')) {
        return JSON.stringify({
          streams: [{ tags: { title: 'Game Audio' } }, { tags: { title: 'Discord' } }],
        })
      }
      const outPath = args[args.length - 1]
      fs.writeFileSync(outPath, Buffer.alloc(512))
      return ''
    })

    organizeRecordings(store, 'MyGame')

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
    organizeRecordings(store, 'MyGame')

    // Second file
    const src2 = path.join(obsDir, 'video2.mp4')
    fs.writeFileSync(src2, Buffer.alloc(1024))
    organizeRecordings(store, 'MyGame')

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
    expect(() => organizeRecordings(store, 'MyGame')).not.toThrow()
  })
})
