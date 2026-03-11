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

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-api-ffcheck-'))

  store = makeMockStore({
    settings: { obsRecordingPath: tmpDir, destinationPath: tmpDir },
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
})

describe('GET /api/ffmpeg-check', () => {
  it('returns { available: true } when execFile succeeds', async () => {
    const cp = await import('child_process')
    cp.execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(null))

    const res = await request(server).get('/api/ffmpeg-check')
    expect(res.status).toBe(200)
    expect(res.body.available).toBe(true)
  })

  it('returns { available: false } when execFile errors', async () => {
    const cp = await import('child_process')
    cp.execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(new Error('not found')))

    const res = await request(server).get('/api/ffmpeg-check')
    expect(res.status).toBe(200)
    expect(res.body.available).toBe(false)
  })
})
