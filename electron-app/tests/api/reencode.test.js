import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// child_process: setup.js patches Module._load + vi.mock for ESM.
// No factory here — keeps same vi.fn() instances so apiServer.js CJS require shares stubs.

import { makeMockStore } from '../helpers/mockStore.js'

let server
let store
let tmpDir
let destDir

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-api-reencode-'))
  destDir = path.join(tmpDir, 'dest')
  fs.mkdirSync(destDir, { recursive: true })

  store = makeMockStore({
    settings: { obsRecordingPath: tmpDir, destinationPath: destDir },
    lockedRecordings: [],
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
  vi.clearAllMocks()
  // Clear dest
  for (const f of fs.readdirSync(destDir)) {
    fs.rmSync(path.join(destDir, f), { force: true })
  }
})

describe('POST /api/reencode', () => {
  it('returns 403 when source_path is outside allowed roots', async () => {
    const res = await request(server)
      .post('/api/reencode')
      .send({ source_path: 'C:\\Windows\\evil.mp4', codec: 'h264', crf: 23 })
    expect(res.status).toBe(403)
  })

  it('returns 404 when source file does not exist', async () => {
    const res = await request(server)
      .post('/api/reencode')
      .send({
        source_path: path.join(destDir, 'missing.mp4'),
        codec: 'h265',
        crf: 23,
      })
    expect(res.status).toBe(404)
  })

  it('returns 500 when ffmpeg errors', async () => {
    const cp = await import('child_process')
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      cb(new Error('encode failed'), '', 'ffmpeg error')
      return { kill: vi.fn() }
    })

    const src = path.join(destDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(1024))

    const res = await request(server)
      .post('/api/reencode')
      .send({ source_path: src, codec: 'h265', crf: 23 })
    expect(res.status).toBe(500)
  })

  it('returns 200 with output info on success', async () => {
    const cp = await import('child_process')
    cp.execFile.mockImplementation((bin, args, opts, cb) => {
      const outPath = args[args.length - 1]
      fs.writeFileSync(outPath, Buffer.alloc(512))
      process.nextTick(() => cb(null, '', ''))
      return { kill: vi.fn() }
    })

    const src = path.join(destDir, 'video.mp4')
    fs.writeFileSync(src, Buffer.alloc(2048))

    const res = await request(server)
      .post('/api/reencode')
      .send({
        source_path: src,
        codec: 'h264',
        crf: 23,
        preset: 'medium',
        replace_original: false,
        original_size: 2048,
      })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.output_path).toBeDefined()
    expect(res.body.size_bytes).toBe(512)
    expect(res.body.savings).toBe(1536) // 2048 - 512
  })
})
