import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { EventEmitter } from 'events'

// child_process: setup.js patches Module._load + vi.mock for ESM.
// No factory here — keeps same vi.fn() instances so apiServer.js CJS require shares stubs.

import { makeMockStore } from '../helpers/mockStore.js'

let server
let store
let tmpDir
let obsDir
let destDir

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-api-video-'))
  obsDir = path.join(tmpDir, 'obs')
  destDir = path.join(tmpDir, 'dest')
  fs.mkdirSync(obsDir, { recursive: true })
  fs.mkdirSync(destDir, { recursive: true })

  store = makeMockStore({
    settings: { obsRecordingPath: obsDir, destinationPath: destDir },
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

describe('GET /api/video', () => {
  it('returns 404 when path param is missing', async () => {
    const res = await request(server).get('/api/video')
    expect(res.status).toBe(404)
  })

  it('returns 403 when path is outside allowed roots', async () => {
    const res = await request(server).get('/api/video?path=C:\\Windows\\evil.mp4')
    expect(res.status).toBe(403)
  })

  it('returns 404 when file does not exist', async () => {
    const fp = path.join(destDir, 'missing.mp4')
    const res = await request(server).get(`/api/video?path=${encodeURIComponent(fp)}`)
    expect(res.status).toBe(404)
  })

  it('returns 200 with correct Content-Type for mp4', async () => {
    const fp = path.join(destDir, 'video.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))
    const res = await request(server).get(`/api/video?path=${encodeURIComponent(fp)}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('video/mp4')
    expect(res.headers['content-length']).toBe('1024')
  })

  it('returns correct Content-Type for mkv', async () => {
    const fp = path.join(destDir, 'video.mkv')
    fs.writeFileSync(fp, Buffer.alloc(512))
    const res = await request(server).get(`/api/video?path=${encodeURIComponent(fp)}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('matroska')
  })

  it('returns 206 with range headers for range request', async () => {
    const fp = path.join(destDir, 'big.mp4')
    fs.writeFileSync(fp, Buffer.alloc(4096))
    const res = await request(server)
      .get(`/api/video?path=${encodeURIComponent(fp)}`)
      .set('Range', 'bytes=0-1023')
    expect(res.status).toBe(206)
    expect(res.headers['content-range']).toMatch(/bytes 0-1023\/4096/)
    expect(res.headers['content-length']).toBe('1024')
  })
})

describe('GET /api/video/tracks', () => {
  it('returns 403 when path param is missing', async () => {
    const res = await request(server).get('/api/video/tracks')
    expect(res.status).toBe(403)
  })

  it('returns 403 when path is outside allowed roots', async () => {
    const res = await request(server).get('/api/video/tracks?path=C:\\Windows\\evil.mp4')
    expect(res.status).toBe(403)
  })

  it('returns 404 when file does not exist', async () => {
    const fp = path.join(destDir, 'missing.mp4')
    const res = await request(server).get(`/api/video/tracks?path=${encodeURIComponent(fp)}`)
    expect(res.status).toBe(404)
  })

  it('returns track list from ffprobe', async () => {
    const cp = await import('child_process')
    const fp = path.join(destDir, 'video.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))

    cp.exec.mockImplementation((cmd, opts, cb) => {
      if (cmd.includes('show_streams')) {
        cb(null, JSON.stringify({
          streams: [
            { index: 0, codec_name: 'aac', channels: 2, channel_layout: 'stereo',
              sample_rate: '48000', tags: { title: 'Game Audio' } },
          ]
        }), '')
      } else {
        cb(null, '120', '')
      }
    })

    const res = await request(server).get(`/api/video/tracks?path=${encodeURIComponent(fp)}`)
    expect(res.status).toBe(200)
    expect(res.body.tracks).toHaveLength(1)
    expect(res.body.tracks[0].title).toBe('Game Audio')
  })

  it('uses sidecar .tracks.json for track titles', async () => {
    const cp = await import('child_process')
    const fp = path.join(destDir, 'video.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))
    fs.writeFileSync(fp + '.tracks.json', JSON.stringify(['My Custom Title', null]))

    cp.exec.mockImplementation((cmd, opts, cb) => {
      cb(null, JSON.stringify({
        streams: [
          { index: 0, codec_name: 'aac', channels: 2, channel_layout: 'stereo',
            sample_rate: '48000', tags: { title: 'Original Title' } },
        ]
      }), '')
    })

    const res = await request(server).get(`/api/video/tracks?path=${encodeURIComponent(fp)}`)
    expect(res.status).toBe(200)
    expect(res.body.tracks[0].title).toBe('My Custom Title')
  })
})

describe('GET /api/video/waveform', () => {
  it('returns 400 for non-numeric track param', async () => {
    const fp = path.join(destDir, 'video.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))
    const res = await request(server).get(
      `/api/video/waveform?path=${encodeURIComponent(fp)}&track=abc`
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for negative track index', async () => {
    const fp = path.join(destDir, 'video.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))
    const res = await request(server).get(
      `/api/video/waveform?path=${encodeURIComponent(fp)}&track=-1`
    )
    expect(res.status).toBe(400)
  })

  it('returns 403 when path outside allowed roots', async () => {
    const res = await request(server).get('/api/video/waveform?path=C:\\evil.mp4&track=0')
    expect(res.status).toBe(403)
  })

  it('returns 404 when file does not exist', async () => {
    const fp = path.join(destDir, 'missing.mp4')
    const res = await request(server).get(
      `/api/video/waveform?path=${encodeURIComponent(fp)}&track=0`
    )
    expect(res.status).toBe(404)
  })

  it('returns empty peaks when ffprobe returns no duration', async () => {
    const cp = await import('child_process')
    const fp = path.join(destDir, 'nodur.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))

    cp.exec.mockImplementation((cmd, opts, cb) => cb(null, '', ''))

    const res = await request(server).get(
      `/api/video/waveform?path=${encodeURIComponent(fp)}&track=0`
    )
    expect(res.status).toBe(200)
    expect(res.body.peaks).toEqual([])
  })

  it('returns normalized peaks for valid audio data', async () => {
    const cp = await import('child_process')
    const fp = path.join(destDir, 'audio.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))

    // Return duration from exec (ffprobe)
    cp.exec.mockImplementation((cmd, opts, cb) => cb(null, '10', ''))

    // Build mock spawn that emits float32 data then closes
    cp.spawn.mockImplementation(() => {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter()
      proc.stderr = { resume: vi.fn() }
      proc.kill = vi.fn()

      // Emit 4 floats: [0.5, 1.0, 0.25, 0.75]
      const buf = Buffer.allocUnsafe(16)
      new Float32Array(buf.buffer)[0] = 0.5
      new Float32Array(buf.buffer)[1] = 1.0
      new Float32Array(buf.buffer)[2] = 0.25
      new Float32Array(buf.buffer)[3] = 0.75

      setTimeout(() => {
        proc.stdout.emit('data', buf)
        proc.emit('close', 0)
      }, 10)
      return proc
    })

    const res = await request(server).get(
      `/api/video/waveform?path=${encodeURIComponent(fp)}&track=0`
    )
    expect(res.status).toBe(200)
    expect(res.body.peaks.length).toBeGreaterThan(0)
    // All peaks normalized to max 1.0
    expect(res.body.peaks.every(p => p >= 0 && p <= 1.0)).toBe(true)
  })
})
