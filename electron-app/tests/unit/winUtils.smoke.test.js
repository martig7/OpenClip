/**
 * Windows-only smoke tests for winUtils.js (koffi / Win32 API bindings).
 *
 * These tests verify that the Win32 API wrappers return values of the
 * correct shape. They call real OS APIs and therefore only run on Windows.
 * No mocking — the goal is to catch broken koffi struct definitions,
 * wrong calling conventions, or ABI regressions that unit mocks cannot catch.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'module'

const isWindows = process.platform === 'win32'

// Load winUtils only on Windows — koffi.load() calls Windows DLLs at import time.
let winUtils
beforeAll(() => {
  if (!isWindows) return
  const _req = createRequire(import.meta.url)
  winUtils = _req('../../electron/winUtils.js')
})

// ── getDiskFreeSpace ──────────────────────────────────────────────────────────

describe.skipIf(!isWindows)('getDiskFreeSpace', () => {
  it('returns { total, used, free } numbers for the system drive', () => {
    const sysDrive = process.env.SystemDrive || 'C:\\'
    const result = winUtils.getDiskFreeSpace(sysDrive)

    expect(result).not.toBeNull()
    expect(typeof result.total).toBe('number')
    expect(typeof result.used).toBe('number')
    expect(typeof result.free).toBe('number')
    // Basic sanity: all values positive, used + free ≤ total
    expect(result.total).toBeGreaterThan(0)
    expect(result.free).toBeGreaterThanOrEqual(0)
    expect(result.used).toBeGreaterThanOrEqual(0)
    expect(result.used + result.free).toBeLessThanOrEqual(result.total + 1) // +1 for rounding
  })

  it('returns null for a path that does not exist', () => {
    // GetDiskFreeSpaceExW returns 0 / fails for invalid paths
    const result = winUtils.getDiskFreeSpace('Z:\\nonexistent-drive-xyz\\')
    // On most machines Z: doesn't exist; function should return null rather than throw
    // (acceptable: null or a valid result if Z: happens to be mounted)
    if (result !== null) {
      expect(typeof result.total).toBe('number')
    }
    // Either null or a shape-correct object — no throw is the key assertion
  })
})

// ── listAudioDevices ──────────────────────────────────────────────────────────

describe.skipIf(!isWindows)('listAudioDevices', () => {
  it('returns an array', () => {
    const devices = winUtils.listAudioDevices()
    expect(Array.isArray(devices)).toBe(true)
  })

  it('each device has name and type fields', () => {
    const devices = winUtils.listAudioDevices()
    for (const d of devices) {
      expect(typeof d.name).toBe('string')
      expect(d.name.length).toBeGreaterThan(0)
      expect(d.type === 'input' || d.type === 'output').toBe(true)
    }
  })
})

// ── listRunningApps ───────────────────────────────────────────────────────────
// Returns: [{ name: string, exe: string, hasWindow: boolean }, ...]
// The current process is excluded (filtered out by the implementation).

describe.skipIf(!isWindows)('listRunningApps', () => {
  it('returns an array', () => {
    const apps = winUtils.listRunningApps()
    expect(Array.isArray(apps)).toBe(true)
  })

  it('each entry has name (string), exe (string) and hasWindow (boolean) fields', () => {
    const apps = winUtils.listRunningApps()
    expect(apps.length).toBeGreaterThan(0)
    for (const app of apps) {
      expect(typeof app.name).toBe('string')
      expect(app.name.length).toBeGreaterThan(0)
      expect(typeof app.exe).toBe('string')
      expect(typeof app.hasWindow).toBe('boolean')
    }
  })

  it('results are sorted by name', () => {
    const apps = winUtils.listRunningApps()
    for (let i = 1; i < apps.length; i++) {
      expect(apps[i - 1].name.localeCompare(apps[i].name)).toBeLessThanOrEqual(0)
    }
  })
})

// ── listWindowsWithProcesses ──────────────────────────────────────────────────
// Returns: [{ title: string, process: string, exe: string, windowClass: string }, ...]

describe.skipIf(!isWindows)('listWindowsWithProcesses', () => {
  it('returns an array', () => {
    const windows = winUtils.listWindowsWithProcesses()
    expect(Array.isArray(windows)).toBe(true)
  })

  it('each entry has title, process, exe and windowClass string fields', () => {
    const windows = winUtils.listWindowsWithProcesses()
    for (const w of windows) {
      expect(typeof w.title).toBe('string')
      expect(w.title.length).toBeGreaterThan(0)
      expect(typeof w.process).toBe('string')
      expect(typeof w.exe).toBe('string')
      expect(typeof w.windowClass).toBe('string')
    }
  })
})
