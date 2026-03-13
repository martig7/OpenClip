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
let markersFile

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-api-markers-'))
  destDir = path.join(tmpDir, 'dest')
  fs.mkdirSync(destDir, { recursive: true })

  // MARKERS_FILE is in USER_DATA/runtime — our electron mock sets USER_DATA to tmpdir/userData
  const userDataDir = path.join(os.tmpdir(), 'openclip-test', 'userData', 'runtime')
  fs.mkdirSync(userDataDir, { recursive: true })
  markersFile = path.join(userDataDir, 'clip_markers.json')

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
  // Reset markers file
  if (fs.existsSync(markersFile)) fs.unlinkSync(markersFile)
})

function setMarkers(markers) {
  fs.writeFileSync(markersFile, JSON.stringify({ markers }))
}

describe('GET /api/markers', () => {
  it('returns 404 when path param is missing', async () => {
    const res = await request(server).get('/api/markers?game_name=Halo')
    expect(res.status).toBe(404)
  })

  it('returns 404 when file does not exist', async () => {
    const fp = path.join(destDir, 'missing.mp4')
    const res = await request(server).get(
      `/api/markers?path=${encodeURIComponent(fp)}&game_name=Halo`
    )
    expect(res.status).toBe(404)
  })

  it('returns empty markers when no duration from ffprobe', async () => {
    const cp = await import('child_process')
    cp.execFile.mockImplementation((bin, args, opts, cb) => cb(null, '', ''))

    const fp = path.join(destDir, 'rec.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))

    const res = await request(server).get(
      `/api/markers?path=${encodeURIComponent(fp)}&game_name=Halo`
    )
    expect(res.status).toBe(200)
    expect(res.body.markers).toEqual([])
    expect(res.body.error).toBeDefined()
  })

  it('returns markers within recording window for matching game', async () => {
    const cp = await import('child_process')
    const duration = 300 // 5 minutes
    cp.execFile.mockImplementation((bin, args, opts, cb) => cb(null, String(duration), ''))

    const fp = path.join(destDir, 'rec.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))

    // Set mtime so recording start is known
    const mtime = new Date(1705340100000) // ~2025-01-15T18:35:00Z
    fs.utimesSync(fp, mtime, mtime)
    const recordingStart = mtime.getTime() / 1000 - duration

    // Marker at 30s into the recording
    const markerTs = recordingStart + 30
    setMarkers([
      { game_name: 'Halo', timestamp: markerTs, created_at: '2025-01-15T18:30:30Z' },
      { game_name: 'Minecraft', timestamp: markerTs, created_at: '2025-01-15T18:30:30Z' }, // wrong game
      { game_name: 'Halo', timestamp: recordingStart - 100, created_at: '...' }, // before recording
    ])

    const res = await request(server).get(
      `/api/markers?path=${encodeURIComponent(fp)}&game_name=Halo`
    )
    expect(res.status).toBe(200)
    expect(res.body.markers).toHaveLength(1)
    expect(res.body.markers[0].position).toBeCloseTo(30, 0)
  })

  it('returns markers sorted by position ascending', async () => {
    const cp = await import('child_process')
    const duration = 600
    cp.execFile.mockImplementation((bin, args, opts, cb) => cb(null, String(duration), ''))

    const fp = path.join(destDir, 'rec2.mp4')
    fs.writeFileSync(fp, Buffer.alloc(1024))
    const mtime = new Date(Date.now())
    fs.utimesSync(fp, mtime, mtime)
    const recordingStart = mtime.getTime() / 1000 - duration

    setMarkers([
      { game_name: 'Halo', timestamp: recordingStart + 100, created_at: '' },
      { game_name: 'Halo', timestamp: recordingStart + 50, created_at: '' },
    ])

    const res = await request(server).get(
      `/api/markers?path=${encodeURIComponent(fp)}&game_name=Halo`
    )
    expect(res.status).toBe(200)
    expect(res.body.markers[0].position).toBeLessThan(res.body.markers[1].position)
  })
})

describe('POST /api/markers/add', () => {
  it('returns 400 when game_name is missing', async () => {
    const res = await request(server)
      .post('/api/markers/add')
      .send({ timestamp: 1705340100 })
    expect(res.status).toBe(400)
  })

  it('returns 400 when timestamp is not a number', async () => {
    const res = await request(server)
      .post('/api/markers/add')
      .send({ game_name: 'Halo', timestamp: 'bad' })
    expect(res.status).toBe(400)
  })

  it('creates the markers file and adds the marker', async () => {
    const res = await request(server)
      .post('/api/markers/add')
      .send({ game_name: 'Halo', timestamp: 1705340100 })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const data = JSON.parse(fs.readFileSync(markersFile, 'utf-8'))
    expect(data.markers).toHaveLength(1)
    expect(data.markers[0].game_name).toBe('Halo')
    expect(data.markers[0].timestamp).toBe(1705340100)
    expect(data.markers[0].created_at).toBeDefined()
  })

  it('appends to existing markers', async () => {
    setMarkers([{ game_name: 'Halo', timestamp: 1705339800, created_at: '' }])
    const res = await request(server)
      .post('/api/markers/add')
      .send({ game_name: 'Halo', timestamp: 1705340100 })
    expect(res.status).toBe(200)

    const data = JSON.parse(fs.readFileSync(markersFile, 'utf-8'))
    expect(data.markers).toHaveLength(2)
  })
})

describe('POST /api/markers/delete', () => {
  it('returns 404 when marker timestamp not found', async () => {
    setMarkers([{ game_name: 'Halo', timestamp: 9999, created_at: '' }])
    const res = await request(server)
      .post('/api/markers/delete')
      .send({ timestamp: 1234 })
    expect(res.status).toBe(404)
  })

  it('returns 200 and removes matching marker', async () => {
    setMarkers([
      { game_name: 'Halo', timestamp: 1705339800, created_at: '' },
      { game_name: 'Halo', timestamp: 1705340100, created_at: '' },
    ])
    const res = await request(server)
      .post('/api/markers/delete')
      .send({ timestamp: 1705339800 })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // Verify marker was removed
    const remaining = JSON.parse(fs.readFileSync(markersFile, 'utf-8'))
    expect(remaining.markers).toHaveLength(1)
    expect(remaining.markers[0].timestamp).toBe(1705340100)
  })
})

describe('GET /api/processing', () => {
  it('returns processing=false and empty jobs when nothing is running', async () => {
    const res = await request(server).get('/api/processing')
    expect(res.status).toBe(200)
    expect(res.body.processing).toBe(false)
    expect(res.body.jobs).toEqual([])
  })
})
