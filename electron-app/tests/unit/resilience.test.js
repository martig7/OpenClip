import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { EventEmitter } from 'events'
import { Module, createRequire } from 'module'

const _reqCC = createRequire(import.meta.url)
const _constantsPath = _reqCC.resolve('../../electron/constants.js')
_reqCC.cache[_constantsPath] = {
  id: _constantsPath,
  filename: _constantsPath,
  loaded: true,
  exports: { PLUGIN_PORT_FILE: '/fake/plugin_port' },
}

const mockReadFileSync = vi.fn()
const mockRequest = vi.fn()

const _prevLoad = Module._load.bind(Module)
Module._load = function (request, parent, isMain) {
  if (request === 'fs' || request === 'node:fs') {
    return { readFileSync: (...args) => mockReadFileSync(...args) }
  }
  if (request === 'http' || request === 'node:http') {
    return { request: (...args) => mockRequest(...args) }
  }
  return _prevLoad(request, parent, isMain)
}

afterAll(() => {
  Module._load = _prevLoad
})

describe('OBS Unreachable Resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function getModule() {
    const mod = await import('../../electron/obsPlugin.js')
    return mod
  }

  it('API server handles OBS unreachable gracefully on getStatus', async () => {
    mockRequest.mockImplementationOnce((opts, cb) => {
      const res = new EventEmitter()
      res.on('error', () => {})
      cb(res)
      setTimeout(() => res.emit('error', new Error('ECONNREFUSED')), 10)
      return { end: vi.fn() }
    })
    mockReadFileSync.mockReturnValue('8080')

    const { callPlugin } = await getModule()
    await expect(callPlugin('getStatus')).rejects.toThrow()
  })

  it('API server handles OBS unreachable on startRecording', async () => {
    mockRequest.mockImplementationOnce((opts, cb) => {
      const res = new EventEmitter()
      res.on('error', () => {})
      cb(res)
      setTimeout(() => res.emit('error', new Error('ETIMEDOUT')), 10)
      return { end: vi.fn() }
    })
    mockReadFileSync.mockReturnValue('8080')

    const { startRecording } = await getModule()
    await expect(startRecording()).rejects.toThrow()
  })

  it('API server handles OBS unreachable on stopRecording', async () => {
    mockRequest.mockImplementationOnce((opts, cb) => {
      const res = new EventEmitter()
      res.on('error', () => {})
      cb(res)
      setTimeout(() => res.emit('error', new Error('ECONNREFUSED')), 10)
      return { end: vi.fn() }
    })
    mockReadFileSync.mockReturnValue('8080')

    const { stopRecording } = await getModule()
    await expect(stopRecording()).rejects.toThrow()
  })
})
