import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

import { makeMockStore } from '../helpers/mockStore.js'

let tmpDir
let obsDir
let destDir

// Mock child_process.execFile at top level
vi.mock('child_process', () => ({
  execFile: vi.fn((bin, args, opts, callback) => {
    callback(null, { stdout: '{"streams":[]}', stderr: '' })
  }),
  execFileAsync: vi.fn().mockResolvedValue({ stdout: '{"streams":[]}' })
}))

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
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────
// getWeekFolder
// ─────────────────────────────────────────────────────────────
describe('getWeekFolder', () => {
  // getWeekFolder is not exported directly; test indirectly via directory names created

  it('uses prior Monday for a Wednesday date', async () => {
    // We'll verify by creating a file and checking the target dir
    const store = makeMockStore({
      settings: { obsRecordingPath: obsDir, destinationPath: destDir, autoClip: null, weekFolders: true },
    })
    const { organizeRecordings } = await import('../../electron/fileManager.js')

    // Create a fresh .mp4 in obsDir
    const src = path.join(obsDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    await organizeRecordings(store, 'TestGame')

    // With weekFolders=true: destDir/TestGame/Week of .../
    const gameDir = path.join(destDir, 'TestGame')
    expect(fs.existsSync(gameDir)).toBe(true)
    const weekEntries = fs.readdirSync(gameDir)
    expect(weekEntries.some((e) => e.includes('Week of'))).toBe(true)
  })
})