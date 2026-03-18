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

// Helper: build a minimal ipcMain mock that captures handlers by channel name
function makeMockIpcMain() {
  const handlers = {}
  return {
    handle: (channel, fn) => {
      handlers[channel] = fn
    },
    invoke: (channel, ...args) => {
      try {
        return Promise.resolve(handlers[channel]({}, ...args))
      } catch (e) {
        return Promise.reject(e)
      }
    },
  }
}

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
