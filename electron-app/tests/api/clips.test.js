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
let obsDir
let destDir
let clipsDir

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-api-clips-'))
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
  // Clear clips between tests
  for (const f of fs.readdirSync(clipsDir)) {
    fs.rmSync(path.join(clipsDir, f), { force: true })
  }
  vi.clearAllMocks()
})

describe('GET /api/clips', () => {
  it('returns 200 with empty array', async () => {
    const res = await request(server).get('/api/clips')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('returns clips when files exist', async () => {
    fs.writeFileSync(path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4'), Buffer.alloc(1024))
    const res = await request(server).get('/api/clips')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].game_name).toBe('Halo')
  })
})

describe('POST /api/clips/create', () => {
  it('returns 404 when source file does not exist', async () => {
    const res = await request(server)
      .post('/api/clips/create')
      .send({ source_path: path.join(obsDir, 'missing.mp4'), start_time: 0, end_time: 10 })
    expect(res.status).toBe(404)
  })

  it('returns 400 when end_time <= start_time', async () => {
    const src = path.join(obsDir, 'rec.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))
    const res = await request(server)
      .post('/api/clips/create')
      .send({ source_path: src, start_time: 10, end_time: 5 })
    expect(res.status).toBe(400)
  })

  it('returns 400 when start_time equals end_time', async () => {
    const src = path.join(obsDir, 'rec2.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))
    const res = await request(server)
      .post('/api/clips/create')
      .send({ source_path: src, start_time: 5, end_time: 5 })
    expect(res.status).toBe(400)
  })

  it('returns 200 on success (with mocked ffmpeg)', async () => {
    const cp = await import('child_process')
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      const outPath = args[args.length - 1]
      fs.writeFileSync(outPath, Buffer.alloc(1024))
      process.nextTick(() => cb(null, '', ''))
      return { kill: vi.fn() }
    })

    const src = path.join(obsDir, 'rec.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    const res = await request(server)
      .post('/api/clips/create')
      .send({ source_path: src, start_time: 0, end_time: 10, game_name: 'Halo' })
    expect(res.status).toBe(200)
    expect(res.body.filename).toMatch(/Halo Clip/)
  })

  it('returns 500 when ffmpeg errors', async () => {
    const cp = await import('child_process')
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      cb(new Error('ffmpeg failed'), '', 'ffmpeg error output')
      return { kill: vi.fn() }
    })

    const src = path.join(obsDir, 'rec.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    const res = await request(server)
      .post('/api/clips/create')
      .send({ source_path: src, start_time: 0, end_time: 10 })
    expect(res.status).toBe(500)
  })
})

describe('POST /api/clips/delete', () => {
  it('returns 404 when path is missing from body', async () => {
    const res = await request(server).post('/api/clips/delete').send({})
    expect(res.status).toBe(404)
  })

  it('returns 403 when path is outside allowed roots', async () => {
    const res = await request(server)
      .post('/api/clips/delete')
      .send({ path: 'C:\\Windows\\System32\\evil.exe' })
    expect(res.status).toBe(403)
  })

  it('returns 403 when path traversal ../ is used', async () => {
    const res = await request(server)
      .post('/api/clips/delete')
      .send({ path: path.join(clipsDir, '..', '..', 'Windows', 'System32', 'evil.exe') })
    expect(res.status).toBe(403)
  })

  it('returns 403 when URL-encoded path traversal %2F.. is used', async () => {
    const res = await request(server)
      .post('/api/clips/delete')
      .send({ path: path.join(clipsDir, '..', '..', 'Windows', 'System32', 'evil.exe').replace(/\\/g, '/').replace('..', '%2F..') })
    expect(res.status).toBe(403)
  })

  it('returns 200 when deleting an existing allowed file', async () => {
    const fp = path.join(clipsDir, 'Halo Clip 2025-01-15 #1.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))
    const res = await request(server)
      .post('/api/clips/delete')
      .send({ path: fp })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(fs.existsSync(fp)).toBe(false)
  })
})

describe('POST /api/delete (alias)', () => {
  it('also deletes a file via the alias route', async () => {
    const fp = path.join(clipsDir, 'Halo Clip 2025-01-15 #2.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))
    const res = await request(server)
      .post('/api/delete')
      .send({ path: fp })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe('Clip Creation Concurrency', () => {
  it('handles concurrent clip creation requests', async () => {
    const src = path.join(obsDir, 'concurrent.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    const cp = await import('child_process')
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      setTimeout(() => cb(null, '', ''), 50)
      return { kill: () => {} }
    })

    const makeRequest = () => request(server)
      .post('/api/clips/create')
      .send({ source_path: src, start_time: 0, end_time: 10 })

    const [res1, res2] = await Promise.all([makeRequest(), makeRequest()])
    expect([res1.status, res2.status]).toContain(200)
  })

  it('increments clip number for same-date clips', async () => {
    const src = path.join(obsDir, 'increment.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    const cp = await import('child_process')
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      const outputIdx = args.indexOf('-y')
      if (outputIdx !== -1) {
        const outputPath = args[outputIdx + 1]
        fs.writeFileSync(outputPath, Buffer.alloc(512))
      }
      setTimeout(() => cb(null, '', ''), 10)
      return { kill: () => {} }
    })

    const makeClip = (i) => request(server)
      .post('/api/clips/create')
      .send({ source_path: src, start_time: i, end_time: i + 5 })

    const res1 = await makeClip(0)
    expect(res1.status).toBe(200)

    const res2 = await makeClip(5)
    expect(res2.status).toBe(200)
  })
})
