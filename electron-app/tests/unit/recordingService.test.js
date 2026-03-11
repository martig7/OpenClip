import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createRequire } from 'module'

const _req = createRequire(import.meta.url)

// electron: uses __mocks__/electron.js (setup.js injects into require.cache + vi.mock for ESM)
// child_process: setup.js patches Module._load + vi.mock for ESM (no factory here — same stubs
//   as Module._load uses, so recordingService.js and test code share the same vi.fn instances)

import * as service from '../../electron/recordingService.js'
import { makeMockStore } from '../helpers/mockStore.js'

let tmpDir, obsDir, destDir, clipsDir, store

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-rs-'))
  obsDir = path.join(tmpDir, 'obs')
  destDir = path.join(tmpDir, 'dest')
  clipsDir = path.join(destDir, 'Clips')
  fs.mkdirSync(obsDir, { recursive: true })
  fs.mkdirSync(destDir, { recursive: true })
  fs.mkdirSync(clipsDir, { recursive: true })

  store = makeMockStore({
    settings: { obsRecordingPath: obsDir, destinationPath: destDir },
    lockedRecordings: [],
    storageSettings: {},
  })

  service.init(store)
  service.invalidateCache()
  vi.clearAllMocks()
})

afterEach(() => {
  service.killAllProcesses()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function makeFile(fp, size = 1024) {
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, Buffer.alloc(size))
}

// ─── parseRecordingInfo ───────────────────────────────────────────
describe('parseRecordingInfo', () => {
  it('extracts date from filename', () => {
    const fp = path.join(destDir, 'Halo Session 2025-01-15 #1.mp4')
    makeFile(fp)
    const info = service.parseRecordingInfo(fp, 'Halo')
    expect(info.date).toBe('2025-01-15')
    expect(info.game_name).toBe('Halo')
  })

  it('falls back to mtime when no date in filename', () => {
    const fp = path.join(destDir, 'random.mp4')
    makeFile(fp)
    expect(service.parseRecordingInfo(fp, 'Unknown').date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns null for non-existent file', () => {
    expect(service.parseRecordingInfo(path.join(destDir, 'missing.mp4'), 'X')).toBeNull()
  })

  it('returns correct size_bytes', () => {
    const fp = path.join(destDir, 'rec.mp4')
    makeFile(fp, 2048)
    expect(service.parseRecordingInfo(fp, 'G').size_bytes).toBe(2048)
  })

  it('returns size_formatted string', () => {
    const fp = path.join(destDir, 'rec.mp4')
    makeFile(fp, 1024 * 1024)
    expect(service.parseRecordingInfo(fp, 'G').size_formatted).toMatch(/MB/)
  })
})

// ─── scanRecordings ───────────────────────────────────────────────
describe('scanRecordings', () => {
  it('returns empty array when no dirs exist', () => {
    store._data.settings.obsRecordingPath = path.join(tmpDir, 'nope')
    store._data.settings.destinationPath = path.join(tmpDir, 'nope2')
    service.invalidateCache()
    expect(service.scanRecordings()).toEqual([])
  })

  it('returns recordings from organized dest folder', () => {
    makeFile(path.join(destDir, 'Halo - Week of Jan 13 2025', 'Halo Session 2025-01-15 #1.mp4'))
    const recs = service.scanRecordings()
    expect(recs).toHaveLength(1)
    expect(recs[0].game_name).toBe('Halo')
  })

  it('skips the Clips subdirectory', () => {
    makeFile(path.join(destDir, 'Halo', 'Halo Session 2025-01-15 #1.mp4'))
    makeFile(path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4'))
    expect(service.scanRecordings().every(r => !r.path.includes('Clips'))).toBe(true)
  })

  it('detects OBS-named files in obsPath', () => {
    makeFile(path.join(obsDir, '2025-01-20 18-30-00.mkv'))
    expect(service.scanRecordings().some(r => r.game_name === '(Unorganized)')).toBe(true)
  })

  it('ignores non-OBS-named files in obsPath', () => {
    makeFile(path.join(obsDir, 'my-home-video.mp4'))
    expect(service.scanRecordings().every(r => r.filename !== 'my-home-video.mp4')).toBe(true)
  })

  it('returns cached results within TTL', () => {
    const recs1 = service.scanRecordings()
    makeFile(path.join(obsDir, '2025-01-20 18-30-00.mkv'))
    expect(service.scanRecordings()).toBe(recs1)
  })

  it('re-scans after invalidateCache', () => {
    service.scanRecordings()
    makeFile(path.join(obsDir, '2025-01-20 18-30-00.mkv'))
    service.invalidateCache()
    expect(service.scanRecordings().some(r => r.filename === '2025-01-20 18-30-00.mkv')).toBe(true)
  })

  it('sorts recordings by mtime descending', () => {
    const gameDir = path.join(destDir, 'Halo')
    const f1 = path.join(gameDir, 'Halo Session 2025-01-13 #1.mp4')
    const f2 = path.join(gameDir, 'Halo Session 2025-01-15 #1.mp4')
    makeFile(f1); fs.utimesSync(f1, new Date(2025, 0, 13), new Date(2025, 0, 13))
    makeFile(f2); fs.utimesSync(f2, new Date(2025, 0, 15), new Date(2025, 0, 15))
    service.invalidateCache()
    const recs = service.scanRecordings()
    expect(recs.length).toBeGreaterThanOrEqual(2)
    expect(recs[0].mtime).toBeGreaterThan(recs[1].mtime)
  })
})

// ─── scanClips ────────────────────────────────────────────────────
describe('scanClips', () => {
  it('returns empty array when no clips dir', () => {
    fs.rmSync(clipsDir, { recursive: true, force: true })
    service.invalidateCache()
    expect(service.scanClips()).toEqual([])
  })

  it('parses game name from clip filename', () => {
    makeFile(path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4'))
    service.invalidateCache()
    expect(service.scanClips()[0].game_name).toBe('Halo')
  })

  it('falls back to Unknown for unrecognized filenames', () => {
    makeFile(path.join(clipsDir, 'random.mp4'))
    service.invalidateCache()
    expect(service.scanClips()[0].game_name).toBe('Unknown')
  })
})

// ─── countClipsForDate ────────────────────────────────────────────
describe('countClipsForDate', () => {
  it('returns 0 when no clips exist', () => {
    expect(service.countClipsForDate(clipsDir, 'Halo', '2025-01-15')).toBe(0)
  })

  it('counts existing clips correctly', () => {
    makeFile(path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4'))
    makeFile(path.join(clipsDir, 'Halo Clip 2025-01-15 #2.mp4'))
    expect(service.countClipsForDate(clipsDir, 'Halo', '2025-01-15')).toBe(2)
  })

  it('returns max clip number', () => {
    makeFile(path.join(clipsDir, 'Halo Clip 2025-01-15 #3.mp4'))
    expect(service.countClipsForDate(clipsDir, 'Halo', '2025-01-15')).toBe(3)
  })

  it('does not count clips for different game', () => {
    makeFile(path.join(clipsDir, 'Minecraft Clip 2025-01-15 #5.mp4'))
    expect(service.countClipsForDate(clipsDir, 'Halo', '2025-01-15')).toBe(0)
  })

  it('returns 0 for non-existent directory', () => {
    expect(service.countClipsForDate(path.join(tmpDir, 'nodir'), 'Halo', '2025-01-15')).toBe(0)
  })

  it('returns cached result on repeated calls without disk changes', () => {
    makeFile(path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4'))
    const first = service.countClipsForDate(clipsDir, 'Halo', '2025-01-15')
    // Adding a file after the first call should not be visible without cache invalidation
    makeFile(path.join(clipsDir, 'Halo Clip 2025-01-15 #2.mp4'))
    expect(service.countClipsForDate(clipsDir, 'Halo', '2025-01-15')).toBe(first)
  })

  it('re-reads disk after invalidateClipsCache clears the date cache', () => {
    makeFile(path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4'))
    expect(service.countClipsForDate(clipsDir, 'Halo', '2025-01-15')).toBe(1)
    makeFile(path.join(clipsDir, 'Halo Clip 2025-01-15 #2.mp4'))
    service.invalidateClipsCache()
    expect(service.countClipsForDate(clipsDir, 'Halo', '2025-01-15')).toBe(2)
  })
})

// ─── deleteFile ───────────────────────────────────────────────────
describe('deleteFile', () => {
  it('deletes a file that exists', () => {
    const fp = path.join(destDir, 'rec.mp4')
    makeFile(fp)
    expect(service.deleteFile(fp)).toEqual({ success: true })
    expect(fs.existsSync(fp)).toBe(false)
  })

  it('also deletes .tracks.json sidecar', () => {
    const fp = path.join(destDir, 'rec.mp4')
    makeFile(fp)
    fs.writeFileSync(fp + '.tracks.json', '[]')
    service.deleteFile(fp)
    expect(fs.existsSync(fp + '.tracks.json')).toBe(false)
  })

  it('returns error for non-existent file', () => {
    const result = service.deleteFile(path.join(destDir, 'missing.mp4'))
    expect(result.error).toBeDefined()
    expect(result.status).toBe(404)
  })

  it('invalidates cache after deletion', () => {
    const fp = path.join(destDir, 'Halo', 'Halo Session 2025-01-15 #1.mp4')
    makeFile(fp)
    service.scanRecordings()
    service.deleteFile(fp)
    expect(service.scanRecordings().every(r => r.path !== fp)).toBe(true)
  })
})

// ─── scanRecordings folder cap ────────────────────────────────────
describe('scanRecordings folder file cap', () => {
  it('caps files per game folder at MAX_FILES_PER_FOLDER (500) and logs a warning', () => {
    const gameDir = path.join(destDir, 'Halo')
    fs.mkdirSync(gameDir, { recursive: true })
    // Create 502 video files — only the first 500 should be scanned
    for (let i = 1; i <= 502; i++) {
      fs.writeFileSync(path.join(gameDir, `Halo Session 2025-01-15 #${i}.mp4`), Buffer.alloc(1))
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    service.invalidateCache()
    const recs = service.scanRecordings()
    expect(recs.filter(r => r.game_name === 'Halo').length).toBe(500)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('capping scan at 500'))
    warnSpy.mockRestore()
  })
})

// ─── scoped cache invalidation ────────────────────────────────────
describe('scoped cache invalidation', () => {
  it('invalidateRecordingsCache does not clear the clips cache', () => {
    makeFile(path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4'))
    const clips1 = service.scanClips()
    service.invalidateRecordingsCache()
    expect(service.scanClips()).toBe(clips1) // same reference — clips cache intact
  })

  it('invalidateClipsCache does not clear the recordings cache', () => {
    makeFile(path.join(destDir, 'Halo', 'Halo Session 2025-01-15 #1.mp4'))
    const recs1 = service.scanRecordings()
    service.invalidateClipsCache()
    expect(service.scanRecordings()).toBe(recs1) // same reference — recordings cache intact
  })

  it('deleteFile of a recording only invalidates the recordings cache', () => {
    const clipFp = path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4')
    const recFp  = path.join(destDir, 'Halo', 'Halo Session 2025-01-15 #1.mp4')
    makeFile(clipFp)
    makeFile(recFp)
    service.invalidateCache()
    const clips1 = service.scanClips()
    service.scanRecordings()
    service.deleteFile(recFp)
    // Clips cache should be untouched (same reference)
    expect(service.scanClips()).toBe(clips1)
    // Recordings cache was cleared so the deleted file is gone
    expect(service.scanRecordings().every(r => r.path !== recFp)).toBe(true)
  })

  it('deleteFile of a clip only invalidates the clips cache', () => {
    const clipFp = path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4')
    const recFp  = path.join(destDir, 'Halo', 'Halo Session 2025-01-15 #1.mp4')
    makeFile(clipFp)
    makeFile(recFp)
    service.invalidateCache()
    const recs1 = service.scanRecordings()
    service.scanClips()
    service.deleteFile(clipFp)
    // Recordings cache should be untouched (same reference)
    expect(service.scanRecordings()).toBe(recs1)
    // Clips cache was cleared so the deleted clip is gone
    expect(service.scanClips().every(c => c.path !== clipFp)).toBe(true)
  })
})

// ─── isClipPath ───────────────────────────────────────────────────
describe('isClipPath', () => {
  it('returns true for a file inside the clips directory', () => {
    const fp = path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4')
    expect(service.isClipPath(fp)).toBe(true)
  })

  it('returns false for a file in the recordings directory', () => {
    const fp = path.join(destDir, 'Halo', 'Halo Session 2025-01-15 #1.mp4')
    expect(service.isClipPath(fp)).toBe(false)
  })

  it('returns false for the clips directory itself', () => {
    expect(service.isClipPath(clipsDir)).toBe(false)
  })

  it('returns false when no clips path is configured', () => {
    store._data.settings.destinationPath = ''
    store._data.settings.obsRecordingPath = ''
    const fp = path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4')
    expect(service.isClipPath(fp)).toBe(false)
  })

  it('returns false for path traversal attempts above clips dir', () => {
    const fp = path.join(clipsDir, '..', 'Halo', 'Halo Session 2025-01-15 #1.mp4')
    expect(service.isClipPath(fp)).toBe(false)
  })

  it('handles non-normalized paths with redundant separators', () => {
    const fp = clipsDir + path.sep + path.sep + 'Halo Clip 2025-01-15 #1.mp4'
    expect(service.isClipPath(fp)).toBe(true)
  })
})
describe('createClip', () => {
  beforeEach(async () => {
    const cp = await import('child_process')
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      makeFile(args[args.length - 1])
      // Defer cb to avoid TDZ: recordingService does `const proc = execFile(..., cb)`
      // and the callback references `proc`, so cb must run after proc is assigned.
      process.nextTick(() => cb(null, '', ''))
      return { kill: vi.fn() }
    })
  })

  it('rejects when source does not exist', async () => {
    await expect(service.createClip(path.join(tmpDir, 'missing.mp4'), 0, 10, 'Halo', null))
      .rejects.toThrow('Source not found')
  })

  it('rejects when endTime <= startTime', async () => {
    const src = path.join(obsDir, 'rec.mp4'); makeFile(src)
    await expect(service.createClip(src, 10, 5, 'Halo', null)).rejects.toThrow('End time')
  })

  it('rejects when no clips folder configured', async () => {
    store._data.settings.destinationPath = ''
    store._data.settings.obsRecordingPath = ''
    // obsIntegration is lazy-required by getObsPath; pre-inject a null stub so the
    // fallback OBS path detection doesn't find a real path on this machine.
    const obsPath = _req.resolve('../../electron/obsIntegration')
    const origObs = _req.cache[obsPath]
    _req.cache[obsPath] = { id: obsPath, filename: obsPath, loaded: true,
      exports: { readOBSRecordingPath: () => null } }
    const src = path.join(tmpDir, 'rec.mp4'); makeFile(src)
    try {
      await expect(service.createClip(src, 0, 10, 'Halo', null)).rejects.toThrow('No clips folder')
    } finally {
      if (origObs) _req.cache[obsPath] = origObs; else delete _req.cache[obsPath]
    }
  })

  it('creates a clip with correct naming', async () => {
    const src = path.join(obsDir, 'rec.mp4'); makeFile(src)
    const result = await service.createClip(src, 0, 10, 'Halo', null)
    expect(result.filename).toMatch(/^Halo Clip \d{4}-\d{2}-\d{2} #1\.mp4$/)
  })

  it('increments clip number when existing clips present', async () => {
    const src = path.join(obsDir, 'rec.mp4'); makeFile(src)
    const today = new Date().toISOString().slice(0, 10)
    makeFile(path.join(clipsDir, `Halo Clip ${today} #1.mp4`))
    const result = await service.createClip(src, 0, 10, 'Halo', null)
    expect(result.filename).toContain('#2')
  })

  it('skips already-existing candidate filename to avoid overwrite under concurrency', async () => {
    const src = path.join(obsDir, 'rec.mp4'); makeFile(src)
    const today = new Date().toISOString().slice(0, 10)
    // Simulate a concurrent request having already claimed #1 (count=0+1) before writing it
    makeFile(path.join(clipsDir, `Halo Clip ${today} #1.mp4`))
    const result = await service.createClip(src, 0, 10, 'Halo', null)
    expect(result.filename).toContain('#2')
    expect(result.filename).not.toContain('#1')
  })

  it('uses -map 0 when no audioTracks specified', async () => {
    const cp = await import('child_process')
    const src = path.join(obsDir, 'rec.mp4'); makeFile(src)
    await service.createClip(src, 0, 10, 'Halo', null)
    const args = cp.execFile.mock.calls[0][1]
    expect(args[args.indexOf('-map') + 1]).toBe('0')
  })

  it('maps single audio track correctly', async () => {
    const cp = await import('child_process')
    const src = path.join(obsDir, 'rec.mp4'); makeFile(src)
    await service.createClip(src, 0, 10, 'Halo', [1])
    expect(cp.execFile.mock.calls[0][1].join(' ')).toContain('0:a:1')
  })

  it('includes amix for multiple audio tracks', async () => {
    const cp = await import('child_process')
    const src = path.join(obsDir, 'rec.mp4'); makeFile(src)
    await service.createClip(src, 0, 10, 'Halo', [0, 1])
    expect(cp.execFile.mock.calls[0][1].join(' ')).toContain('amix')
  })
})

// ─── runAutoDelete ────────────────────────────────────────────────
describe('runAutoDelete', () => {
  it('returns zeros when auto-delete is disabled', () => {
    store._data.storageSettings = { auto_delete_enabled: false }
    expect(service.runAutoDelete()).toEqual({ deleted: 0, skipped: 0, errors: 0 })
  })

  it('deletes files older than max_age_days', () => {
    store._data.storageSettings = { auto_delete_enabled: true, max_age_days: 1, max_storage_gb: 9999, exclude_clips: true }
    const fp = path.join(destDir, 'Halo', 'Halo Session 2025-01-01 #1.mp4')
    makeFile(fp)
    fs.utimesSync(fp, new Date(Date.now() - 2 * 86400000), new Date(Date.now() - 2 * 86400000))
    service.invalidateCache()
    expect(service.runAutoDelete().deleted).toBe(1)
    expect(fs.existsSync(fp)).toBe(false)
  })

  it('skips locked recordings', () => {
    const fp = path.join(destDir, 'Halo', 'Halo Session 2025-01-01 #1.mp4')
    makeFile(fp)
    fs.utimesSync(fp, new Date(Date.now() - 2 * 86400000), new Date(Date.now() - 2 * 86400000))
    store._data.lockedRecordings = [fp]
    store._data.storageSettings = { auto_delete_enabled: true, max_age_days: 1, max_storage_gb: 9999, exclude_clips: true }
    service.invalidateCache()
    expect(service.runAutoDelete().skipped).toBeGreaterThan(0)
    expect(fs.existsSync(fp)).toBe(true)
  })

  it('does not delete clips when exclude_clips is true', () => {
    const fp = path.join(clipsDir, 'Halo Clip 2025-01-01 #1.mp4')
    makeFile(fp)
    fs.utimesSync(fp, new Date(Date.now() - 2 * 86400000), new Date(Date.now() - 2 * 86400000))
    store._data.storageSettings = { auto_delete_enabled: true, max_age_days: 1, max_storage_gb: 9999, exclude_clips: true }
    service.invalidateCache()
    service.runAutoDelete()
    expect(fs.existsSync(fp)).toBe(true)
  })

  it('deletes clips when exclude_clips is false', () => {
    const fp = path.join(clipsDir, 'Halo Clip 2025-01-01 #1.mp4')
    makeFile(fp)
    fs.utimesSync(fp, new Date(Date.now() - 2 * 86400000), new Date(Date.now() - 2 * 86400000))
    store._data.storageSettings = { auto_delete_enabled: true, max_age_days: 1, max_storage_gb: 9999, exclude_clips: false }
    service.invalidateCache()
    expect(service.runAutoDelete().deleted).toBe(1)
    expect(fs.existsSync(fp)).toBe(false)
  })
})
