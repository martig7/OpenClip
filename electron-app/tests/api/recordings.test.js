import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// child_process: setup.js patches Module._load + vi.mock for ESM.
// No factory here — keeps same vi.fn() instances so apiServer.js CJS require shares stubs.

import { makeMockStore } from "../helpers/mockStore.js"
import { createRequire } from 'module'
const _cjsReq = createRequire(import.meta.url)
const recordingService = _cjsReq('../../electron/recordingService.js')

let server
let store
let tmpDir
let obsDir
let destDir

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-api-rec-'))
  obsDir = path.join(tmpDir, 'obs')
  destDir = path.join(tmpDir, 'dest')
  fs.mkdirSync(obsDir, { recursive: true })
  fs.mkdirSync(destDir, { recursive: true })

  store = makeMockStore({
    settings: { obsRecordingPath: obsDir, destinationPath: destDir },
    lockedRecordings: [],
    storageSettings: {},
  })

  const { startApiServer } = await import('../../electron/apiServer.js')
  server = startApiServer(store)
  await new Promise(resolve => server.on('listening', resolve))
})

afterAll((done) => {
  server.close(done)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  recordingService.invalidateCache()
  // Clear obs and dest dirs between tests
  for (const f of fs.readdirSync(obsDir)) fs.rmSync(path.join(obsDir, f), { recursive: true, force: true })
  for (const f of fs.readdirSync(destDir)) fs.rmSync(path.join(destDir, f), { recursive: true, force: true })
})

describe('GET /api/recordings', () => {
  it('returns 200 with an empty array when no recordings', async () => {
    const res = await request(server).get('/api/recordings')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns CORS header', async () => {
    const res = await request(server).get('/api/recordings')
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it('returns recordings when files exist', async () => {
    const gameDir = path.join(destDir, 'Halo - Week of Jan 13 2025')
    fs.mkdirSync(gameDir, { recursive: true })
    fs.writeFileSync(path.join(gameDir, 'Halo Session 2025-01-15 #1.mp4'), Buffer.alloc(1024))

    const res = await request(server).get('/api/recordings')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].game_name).toBe('Halo')
  })

  it('responds to OPTIONS preflight with 204', async () => {
    const res = await request(server).options('/api/recordings')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-methods']).toContain('GET')
  })

  it('returns empty array when recordings dir does not exist yet', async () => {
    store.get.mockReturnValueOnce({ 
      obsRecordingPath: '/nonexistent/path', 
      destinationPath: destDir 
    })
    recordingService.invalidateCache()
    
    const res = await request(server).get('/api/recordings')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns recordings sorted by date (newest first)', async () => {
    const gameDir = path.join(destDir, 'Halo - Week of Jan 13 2025')
    fs.mkdirSync(gameDir, { recursive: true })
    const olderFile = path.join(gameDir, 'Halo Session 2025-01-15 #1.mp4')
    const newerFile = path.join(gameDir, 'Halo Session 2025-01-15 #2.mp4')
    fs.writeFileSync(olderFile, Buffer.alloc(1024))
    fs.writeFileSync(newerFile, Buffer.alloc(1024))
    // Explicitly set different mtimes so sort order is deterministic
    const olderTime = new Date('2025-01-15T10:00:00Z')
    const newerTime = new Date('2025-01-15T11:00:00Z')
    fs.utimesSync(olderFile, olderTime, olderTime)
    fs.utimesSync(newerFile, newerTime, newerTime)

    recordingService.invalidateCache()
    const res = await request(server).get('/api/recordings')
    expect(res.status).toBe(200)
    expect(res.body.length).toBe(2)
    // Newest first (higher mtime first)
    expect(res.body[0].mtime).toBeGreaterThan(res.body[1].mtime)
  })
})
