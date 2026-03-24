import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

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
// organizeSpecificRecording
// ─────────────────────────────────────────────────────────────────
describe('organizeSpecificRecording', () => {
  let store

  beforeEach(() => {
    vi.resetModules()
    store = makeMockStore({
      settings: { destinationPath: destDir, weekFolders: true },
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
    // With weekFolders=true: destDir/TestGame/Week of Jan 8 2024/
    const destEntries = fs.readdirSync(destDir)
    expect(destEntries).toHaveLength(1)
    expect(destEntries[0]).toBe('TestGame')
    const weekEntries = fs.readdirSync(path.join(destDir, 'TestGame'))
    expect(weekEntries).toHaveLength(1)
    // Week folder must reflect the file's mtime (Jan 2024), not today's date
    expect(weekEntries[0]).toMatch(/Jan.*2024/)
    expect(weekEntries[0]).toContain('Jan 8 2024')
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
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw mkdirErr
    })

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
    const renameErr = Object.assign(new Error('ENOSPC: no space left on device'), {
      code: 'ENOSPC',
    })
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw renameErr
    })

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

    const exdevErr = Object.assign(new Error('EXDEV: cross-device link not permitted, rename'), {
      code: 'EXDEV',
    })
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw exdevErr
    })

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

    const exdevErr = Object.assign(new Error('EXDEV: cross-device link not permitted, rename'), {
      code: 'EXDEV',
    })
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw exdevErr
    })

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
    const remuxCalls = cp.execFile.mock.calls.filter(
      ([, args]) => args && args.includes('-movflags')
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
    const remuxCalls = cp.execFile.mock.calls.filter(
      ([, args]) => args && args.includes('-movflags')
    )
    expect(remuxCalls).toHaveLength(1)
  })

  it('returns alreadyOrganized=true for a file already under destPath (default behavior)', async () => {
    // Place file inside destDir (already "organized")
    const subDir = path.join(destDir, 'Halo - Week of Jan 8 2024')
    fs.mkdirSync(subDir, { recursive: true })
    const filePath = path.join(subDir, 'session.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')
    const result = await organizeSpecificRecording(store, filePath, 'AnotherGame')

    expect(result.success).toBe(true)
    expect(result.alreadyOrganized).toBe(true)
    // File should NOT have moved
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('moves a file already under destPath when forceReorganize=true', async () => {
    const subDir = path.join(destDir, 'Halo - Week of Jan 8 2024')
    fs.mkdirSync(subDir, { recursive: true })
    const filePath = path.join(subDir, 'session.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    const { organizeSpecificRecording } = await import('../../electron/fileManager.js')

    vi.useFakeTimers()
    const organizePromise = organizeSpecificRecording(store, filePath, 'AnotherGame', { forceReorganize: true })
    await vi.runAllTimersAsync()
    const result = await organizePromise
    vi.useRealTimers()

    expect(result.success).toBe(true)
    expect(result.alreadyOrganized).toBeUndefined()
    // A new folder for AnotherGame should exist under destDir
    const entries = fs.readdirSync(destDir)
    expect(entries.some((e) => e.startsWith('AnotherGame'))).toBe(true)
  })
})
