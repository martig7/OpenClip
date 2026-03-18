/**
 * Tests for moveFileSafe (via organizeSpecificRecording/organizeRecordings)
 * and locked-file skip behavior in organizeRecordings/finalizeDirectRecording.
 *
 * moveFileSafe is not exported directly; it's exercised through the exported
 * functions that call it. fs.renameSync, fs.promises.copyFile and
 * fs.promises.unlink are spied on to simulate EBUSY/EXDEV conditions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { makeMockStore } from '../helpers/mockStore.js'

let tmpDir, obsDir, destDir, store

beforeEach(async () => {
  vi.resetModules()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-movesafe-'))
  obsDir = path.join(tmpDir, 'obs')
  destDir = path.join(tmpDir, 'dest')
  fs.mkdirSync(obsDir, { recursive: true })
  fs.mkdirSync(destDir, { recursive: true })
  store = makeMockStore({
    settings: { obsRecordingPath: obsDir, destinationPath: destDir, autoClip: null },
  })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

/**
 * Run organizeSpecificRecording with fake timers so the stability check
 * (setTimeout 1500ms) and any EBUSY backoffs (setTimeout 500/1000ms) resolve.
 */
async function organizeFile(filePath, gameName = 'MyGame') {
  const { organizeSpecificRecording } = await import('../../electron/fileManager.js')
  vi.useFakeTimers()
  const p = organizeSpecificRecording(store, filePath, gameName)
  p.catch(() => {}) // suppress during timer advance
  await vi.runAllTimersAsync()
  vi.useRealTimers()
  return p
}

// ── EBUSY rename retry ────────────────────────────────────────────────────────

describe('moveFileSafe — EBUSY rename retry', () => {
  it('succeeds on the second attempt after one transient EBUSY', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    let attempts = 0
    const origRename = fs.renameSync.bind(fs)
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
      attempts++
      if (attempts === 1) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return origRename(...args)
    })

    const result = await organizeFile(filePath)
    renameSpy.mockRestore()

    expect(result.success).toBe(true)
    expect(attempts).toBe(2)
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(result.path)).toBe(true)
  })

  it('succeeds on the third attempt after two transient EBUSYs', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    let attempts = 0
    const origRename = fs.renameSync.bind(fs)
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
      attempts++
      if (attempts <= 2) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return origRename(...args)
    })

    const result = await organizeFile(filePath)
    renameSpy.mockRestore()

    expect(result.success).toBe(true)
    expect(attempts).toBe(3)
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(result.path)).toBe(true)
  })

  it('falls back to copy+delete after three persistent EBUSY failures', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    const content = Buffer.alloc(1024, 0xab)
    fs.writeFileSync(filePath, content)

    let renameCallCount = 0
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      renameCallCount++
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    })

    const result = await organizeFile(filePath)
    const callCount = renameCallCount // capture before restore
    renameSpy.mockRestore()

    expect(callCount).toBe(3)
    expect(result.success).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(result.path)).toBe(true)
    // Destination content must match the original
    expect(fs.readFileSync(result.path)).toEqual(content)
  })
})

// ── EXDEV cross-device fallback ───────────────────────────────────────────────

describe('moveFileSafe — EXDEV immediate copy+delete fallback', () => {
  it('falls back to copy+delete immediately on EXDEV without retrying rename', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    const content = Buffer.alloc(1024, 0xcd)
    fs.writeFileSync(filePath, content)

    let renameAttempts = 0
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      renameAttempts++
      throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
    })

    const result = await organizeFile(filePath)
    renameSpy.mockRestore()

    // EXDEV must break immediately — only 1 rename attempt, no backoff
    expect(renameAttempts).toBe(1)
    expect(result.success).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(result.path)).toBe(true)
    expect(fs.readFileSync(result.path)).toEqual(content)
  })
})

// ── unlink retry on copy+delete path ─────────────────────────────────────────

describe('moveFileSafe — unlink retry on copy+delete path', () => {
  it('retries unlink once after a transient EBUSY and then succeeds', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    // Force copy+delete path via EXDEV
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
    })

    let unlinkAttempts = 0
    const origUnlink = fs.promises.unlink.bind(fs.promises)
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockImplementation(async (...args) => {
      unlinkAttempts++
      if (unlinkAttempts === 1) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return origUnlink(...args)
    })

    const result = await organizeFile(filePath)
    unlinkSpy.mockRestore()

    expect(result.success).toBe(true)
    expect(unlinkAttempts).toBe(2)
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(result.path)).toBe(true)
  })

  it('rolls back the copy and re-throws when unlink fails after all retries', async () => {
    const filePath = path.join(obsDir, 'recording.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
    })
    vi.spyOn(fs.promises, 'unlink').mockRejectedValue(
      Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    )

    // organizeSpecificRecording wraps the error from moveFileSafe
    await expect(organizeFile(filePath)).rejects.toThrow(/Could not move file/)

    // Original file must still be accessible — no data was lost
    expect(fs.existsSync(filePath)).toBe(true)
  })
})

// ── organizeRecordings: locked-file skip ─────────────────────────────────────

describe('organizeRecordings — locked-file skip', () => {
  it('skips a locked MP4 and leaves it untouched in obsDir', async () => {
    vi.resetModules()
    const { organizeRecordings } = await import('../../electron/fileManager.js')

    const filePath = path.join(obsDir, 'session.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))

    // Simulate Windows Search Indexer holding the file open throughout all lock checks
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    })

    vi.useFakeTimers()
    const p = organizeRecordings(store, 'MyGame')
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    await p

    // File must still be in obsDir — locked file should be skipped, not moved
    expect(fs.existsSync(filePath)).toBe(true)
    // destDir must be empty — nothing was organized
    expect(fs.readdirSync(destDir)).toHaveLength(0)
  })

  it('continues to process subsequent files when one is locked', async () => {
    vi.resetModules()
    const { organizeRecordings } = await import('../../electron/fileManager.js')

    const locked = path.join(obsDir, 'locked.mp4')
    const good = path.join(obsDir, 'good.mp4')
    fs.writeFileSync(locked, Buffer.alloc(512))
    fs.writeFileSync(good, Buffer.alloc(1024))

    const origOpen = fs.openSync.bind(fs)
    vi.spyOn(fs, 'openSync').mockImplementation((p, flags) => {
      if (p === locked) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return origOpen(p, flags)
    })

    vi.useFakeTimers()
    const p = organizeRecordings(store, 'MyGame')
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    await p

    // The locked file is still in obsDir
    expect(fs.existsSync(locked)).toBe(true)
    // The good file was organized into destDir
    const weekDirs = fs.readdirSync(destDir)
    expect(weekDirs.length).toBeGreaterThan(0)
    const movedFiles = weekDirs.flatMap((d) =>
      fs.readdirSync(path.join(destDir, d)).filter((f) => f.endsWith('.mp4'))
    )
    expect(movedFiles.length).toBeGreaterThan(0)
  })
})

// ── finalizeDirectRecording: locked-file skip ─────────────────────────────────

describe('finalizeDirectRecording — locked-file skip', () => {
  it('skips a locked file and leaves it untouched in the session dir', async () => {
    vi.resetModules()
    const { finalizeDirectRecording } = await import('../../electron/fileManager.js')

    const sessionDir = path.join(destDir, 'MyGame - Week of Mar 9 2026')
    fs.mkdirSync(sessionDir, { recursive: true })
    const filePath = path.join(sessionDir, '2026-03-15 14-30-00.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(1024))
    const lockedStore = makeMockStore({
      settings: { obsRecordingPath: obsDir, destinationPath: destDir, autoClip: null },
    })

    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    })

    vi.useFakeTimers()
    const p = finalizeDirectRecording(lockedStore, 'MyGame', sessionDir)
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    await p

    // File must be untouched — skipped due to lock
    expect(fs.existsSync(filePath)).toBe(true)
    // No session-format file was created
    const sessionFiles = fs.readdirSync(sessionDir).filter((f) => f.includes('Session'))
    expect(sessionFiles).toHaveLength(0)
  })
})
