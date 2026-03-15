import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// child_process: setup.js patches Module._load + vi.mock for ESM.
// No factory here — keeps same vi.fn() instances so apiServer.js CJS require shares stubs.

import { makeMockStore } from '../helpers/mockStore.js'
import { createRequire } from 'module'
const _cjsReq = createRequire(import.meta.url)
const recordingService = _cjsReq('../../electron/recordingService.js')

let server
let store
let tmpDir
let destDir
let clipsDir

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-api-storage-'))
  destDir = path.join(tmpDir, 'dest')
  clipsDir = path.join(destDir, 'Clips')
  fs.mkdirSync(destDir, { recursive: true })
  fs.mkdirSync(clipsDir, { recursive: true })

  store = makeMockStore({
    settings: { obsRecordingPath: tmpDir, destinationPath: destDir },
    lockedRecordings: [],
    storageSettings: null,
  })

  const { startApiServer } = await import('../../electron/apiServer.js')
  server = startApiServer(store)
  await new Promise(resolve => server.on('listening', resolve))
})

afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(async () => {
  recordingService.invalidateCache()
  vi.clearAllMocks()
  store._data.lockedRecordings = []
  store._data.storageSettings = null

  // Clear dest & clips
  for (const f of fs.readdirSync(destDir)) {
    if (f !== 'Clips') fs.rmSync(path.join(destDir, f), { recursive: true, force: true })
  }
  for (const f of fs.readdirSync(clipsDir)) {
    fs.rmSync(path.join(clipsDir, f), { force: true })
  }

  // Mock getDiskUsage (PowerShell exec)
  const cp = await import('child_process')
  cp.exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''))
})

describe('GET /api/storage/stats', () => {
  it('returns required fields', async () => {
    const res = await request(server).get('/api/storage/stats')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('recordings')
    expect(res.body).toHaveProperty('clips')
    expect(res.body).toHaveProperty('total_size')
    expect(res.body).toHaveProperty('games')
    expect(res.body).toHaveProperty('locked_recordings')
  })

  it('groups recordings by game name', async () => {
    const gameDir = path.join(destDir, 'Halo - Week of Jan 13 2025')
    fs.mkdirSync(gameDir, { recursive: true })
    fs.writeFileSync(path.join(gameDir, 'Halo Session 2025-01-15 #1.mp4'), Buffer.alloc(1024))
    fs.writeFileSync(path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4'), Buffer.alloc(512))

    const res = await request(server).get('/api/storage/stats')
    expect(res.status).toBe(200)
    expect(res.body.games['Halo']).toBeDefined()
    expect(res.body.games['Halo'].recordings).toHaveLength(1)
    expect(res.body.games['Halo'].clips).toHaveLength(1)
  })

  it('returns null disk_usage when destPath does not exist', async () => {
    store._data.settings.destinationPath = path.join(tmpDir, 'nonexistent')
    const res = await request(server).get('/api/storage/stats')
    expect(res.body.disk_usage).toBeNull()
    store._data.settings.destinationPath = destDir
  })
})

describe('GET /api/storage/settings', () => {
  it('returns default settings when none stored', async () => {
    const res = await request(server).get('/api/storage/settings')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      auto_delete_enabled: false,
      max_storage_gb: 100,
      max_age_days: 30,
      exclude_clips: true,
    })
  })

  it('returns stored settings', async () => {
    store._data.storageSettings = {
      auto_delete_enabled: true,
      max_storage_gb: 50,
      max_age_days: 7,
      exclude_clips: false,
    }
    const res = await request(server).get('/api/storage/settings')
    expect(res.body.auto_delete_enabled).toBe(true)
    expect(res.body.max_storage_gb).toBe(50)
  })
})

describe('POST /api/storage/settings', () => {
  it('saves settings and returns success', async () => {
    const newSettings = {
      auto_delete_enabled: true,
      max_storage_gb: 75,
      max_age_days: 14,
      exclude_clips: false,
    }
    const res = await request(server)
      .post('/api/storage/settings')
      .send({ storage_settings: newSettings })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(store.set).toHaveBeenCalledWith('storageSettings', newSettings)
  })
})

describe('POST /api/storage/lock', () => {
  it('locks a path', async () => {
    const fp = path.join(destDir, 'rec.mp4')
    const res = await request(server)
      .post('/api/storage/lock')
      .send({ path: fp, locked: true })
    expect(res.status).toBe(200)
    expect(store._data.lockedRecordings).toContain(path.normalize(fp))
  })

  it('unlocks a path', async () => {
    const fp = path.join(destDir, 'rec.mp4')
    store._data.lockedRecordings = [path.normalize(fp)]
    const res = await request(server)
      .post('/api/storage/lock')
      .send({ path: fp, locked: false })
    expect(res.status).toBe(200)
    expect(store._data.lockedRecordings).not.toContain(path.normalize(fp))
  })
})

describe('POST /api/storage/delete-batch', () => {
  it('deletes all specified files', async () => {
    const fp1 = path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4')
    const fp2 = path.join(clipsDir, 'Halo Clip 2025-01-15 #2.mp4')
    fs.writeFileSync(fp1, Buffer.alloc(1024))
    fs.writeFileSync(fp2, Buffer.alloc(1024))

    const res = await request(server)
      .post('/api/storage/delete-batch')
      .send({ paths: [fp1, fp2] })
    expect(res.status).toBe(200)
    expect(res.body.deleted_count).toBe(2)
    expect(res.body.skipped_locked_count).toBe(0)
    expect(fs.existsSync(fp1)).toBe(false)
    expect(fs.existsSync(fp2)).toBe(false)
  })

  it('skips locked recordings', async () => {
    const fp1 = path.join(clipsDir, 'Locked Clip 2025-01-15 #1.mp4')
    const fp2 = path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4')
    fs.writeFileSync(fp1, Buffer.alloc(1024))
    fs.writeFileSync(fp2, Buffer.alloc(1024))
    store._data.lockedRecordings = [path.normalize(fp1)]

    const res = await request(server)
      .post('/api/storage/delete-batch')
      .send({ paths: [fp1, fp2] })
    expect(res.status).toBe(200)
    expect(res.body.deleted_count).toBe(1)
    expect(res.body.skipped_locked_count).toBe(1)
    expect(fs.existsSync(fp1)).toBe(true) // locked, not deleted
    expect(fs.existsSync(fp2)).toBe(false)
  })

  it('reports failed deletions for missing files', async () => {
    const fp = path.join(clipsDir, 'nonexistent.mp4')
    const res = await request(server)
      .post('/api/storage/delete-batch')
      .send({ paths: [fp] })
    expect(res.status).toBe(200)
    expect(res.body.failed_count).toBe(1)
  })
})

describe('Storage - Edge Cases', () => {
  it('stats with zero disk usage reports correctly', async () => {
    const cp = await import('child_process')
    cp.exec.mockImplementation((cmd, opts, cb) => {
      cb(null, '0', '')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await request(server).get('/api/storage/stats')
    errorSpy.mockRestore()
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('disk_usage')
  })

  it('lock/unlock round-trip persists in store', async () => {
    const fp = path.join(destDir, 'persist.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))
    
    // Lock
    await request(server)
      .post('/api/storage/lock')
      .send({ path: fp, locked: true })
    expect(store._data.lockedRecordings).toContain(path.normalize(fp))
    
    // Unlock
    await request(server)
      .post('/api/storage/lock')
      .send({ path: fp, locked: false })
    expect(store._data.lockedRecordings).not.toContain(path.normalize(fp))
  })

  it('concurrent delete-batch requests succeed and maintain clean state', async () => {
    const fp1 = path.join(destDir, 'file1.mp4')
    const fp2 = path.join(destDir, 'file2.mp4')
    fs.writeFileSync(fp1, Buffer.alloc(1024))
    fs.writeFileSync(fp2, Buffer.alloc(1024))

    const deleteReq1 = request(server)
      .post('/api/storage/delete-batch')
      .send({ paths: [fp1] })
    
    const deleteReq2 = request(server)
      .post('/api/storage/delete-batch')
      .send({ paths: [fp2] })

    const [res1, res2] = await Promise.all([deleteReq1, deleteReq2])
    
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(store._data.lockedRecordings).toEqual([])
  })
})
