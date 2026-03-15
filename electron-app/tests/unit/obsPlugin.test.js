import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { Module, createRequire } from 'module'

// ── Constants mock via require.cache ───────────────────────────────────────────
// vi.mock() only intercepts Vite's ESM pipeline, not CJS require(). Injecting
// directly into Node's require.cache is the reliable pattern (same as setup.js
// uses for the electron mock).
const _reqCC = createRequire(import.meta.url)
const _constantsPath = _reqCC.resolve('../../electron/constants.js')
_reqCC.cache[_constantsPath] = {
  id: _constantsPath,
  filename: _constantsPath,
  loaded: true,
  exports: { PLUGIN_PORT_FILE: '/fake/plugin_port' },
}

// ── Mock built-in modules via Module._load ─────────────────────────────────────
// vi.mock() only intercepts Vite's ESM pipeline, not native CJS require() for
// built-ins.  Chain onto the existing Module._load (already patched by setup.js
// for child_process) so child_process mocks keep working.
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

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal ClientRequest-like EventEmitter. */
function makeReq() {
  const req = new EventEmitter()
  req.write = vi.fn()
  req.end = vi.fn()
  req.destroy = vi.fn()
  return req
}

/**
 * Queue a successful JSON response for the next http.request call.
 * The response is delivered on the next microtask tick so that the
 * callPlugin Promise has time to register its 'data'/'end' listeners
 * before the events fire.  Returns the fake req in case the test needs
 * to inspect req.write / req.end calls.
 */
function queueSuccessResponse(jsonBody) {
  const req = makeReq()
  mockRequest.mockImplementationOnce((_opts, cb) => {
    Promise.resolve().then(() => {
      const res = new EventEmitter()
      cb(res)
      res.emit('data', JSON.stringify(jsonBody))
      res.emit('end')
    })
    return req
  })
  return req
}

/**
 * Queue an error event for the next http.request call.
 * Returns the fake req.
 */
function queueErrorResponse(err) {
  const req = makeReq()
  mockRequest.mockImplementationOnce(() => {
    Promise.resolve().then(() => req.emit('error', err))
    return req
  })
  return req
}

/** Fresh import of obsPlugin so module-level caches are reset each test. */
async function getModule() {
  vi.resetModules()
  return await import('../../electron/obsPlugin.js')
}

// ─── Port discovery & cache ────────────────────────────────────────────────────

describe('readPluginPort / port cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileSync.mockReturnValue('28756')
  })

  it('reads port from the port file', async () => {
    queueSuccessResponse({ success: true, data: { obsVersion: '30.0', pluginVersion: '1.0' } })
    const { callPlugin } = await getModule()

    await callPlugin('getStatus')

    expect(mockReadFileSync).toHaveBeenCalledWith('/fake/plugin_port', 'utf-8')
  })

  it('throws when port file is missing', async () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT') })
    const { callPlugin } = await getModule()
    await expect(callPlugin('getStatus')).rejects.toThrow('not running')
  })

  it('throws when port file contains an invalid value', async () => {
    mockReadFileSync.mockReturnValue('notaport')
    const { callPlugin } = await getModule()
    await expect(callPlugin('getStatus')).rejects.toThrow('not running')
  })

  it('caches the port and does not re-read within cache window', async () => {
    queueSuccessResponse({ success: true, data: {} })
    const { callPlugin } = await getModule()
    await callPlugin('getStatus')

    // Second call — port should be cached
    queueSuccessResponse({ success: true, data: {} })
    await callPlugin('getStatus')

    // readFileSync should have been called only once (first call)
    expect(mockReadFileSync).toHaveBeenCalledTimes(1)
  })

  it('invalidatePortCache causes next call to re-read the file', async () => {
    queueSuccessResponse({ success: true, data: {} })
    const { callPlugin, invalidatePortCache } = await getModule()
    await callPlugin('getStatus')
    expect(mockReadFileSync).toHaveBeenCalledTimes(1)

    invalidatePortCache()

    queueSuccessResponse({ success: true, data: {} })
    await callPlugin('getStatus')
    expect(mockReadFileSync).toHaveBeenCalledTimes(2)
  })
})

// ─── callPlugin request / response ────────────────────────────────────────────

describe('callPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileSync.mockReturnValue('28756')
  })

  it('sends POST to /api with correct JSON body', async () => {
    const req = queueSuccessResponse({ success: true, data: ['Scene1'] })
    const { callPlugin } = await getModule()

    await callPlugin('getScenes', { foo: 'bar' })

    expect(req.write).toHaveBeenCalledWith(
      JSON.stringify({ method: 'getScenes', params: { foo: 'bar' } })
    )
    const [opts] = mockRequest.mock.calls[0]
    expect(opts.path).toBe('/api')
    expect(opts.method).toBe('POST')
    expect(opts.hostname).toBe('127.0.0.1')
    expect(opts.port).toBe(28756)
  })

  it('resolves with data field on success', async () => {
    queueSuccessResponse({ success: true, data: { obsVersion: '30.0' } })
    const { callPlugin } = await getModule()

    const result = await callPlugin('getStatus')
    expect(result).toEqual({ obsVersion: '30.0' })
  })

  it('rejects when plugin returns success: false', async () => {
    queueSuccessResponse({ success: false, error: 'Unknown method' })
    const { callPlugin } = await getModule()

    await expect(callPlugin('badMethod')).rejects.toThrow('Unknown method')
  })

  it('rejects on ECONNREFUSED with a user-friendly message', async () => {
    queueErrorResponse(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }))
    const { callPlugin } = await getModule()

    await expect(callPlugin('getStatus')).rejects.toThrow(/Cannot connect/)
  })

  it('rejects on timeout and calls req.destroy', async () => {
    const req = makeReq()
    mockRequest.mockImplementationOnce(() => {
      Promise.resolve().then(() => req.emit('timeout'))
      return req
    })
    const { callPlugin } = await getModule()

    await expect(callPlugin('getStatus')).rejects.toThrow(/timed out/)
    expect(req.destroy).toHaveBeenCalled()
  })

  it('rethrows malformed JSON response as structured error', async () => {
    const req = makeReq()
    mockRequest.mockImplementationOnce((_opts, cb) => {
      Promise.resolve().then(() => {
        const res = new EventEmitter()
        cb(res)
        res.emit('data', 'not valid json {')
        res.emit('end')
      })
      return req
    })
    const { callPlugin } = await getModule()

    await expect(callPlugin('getStatus')).rejects.toThrow(/Invalid response/)
  })
})

describe('stopRecording', () => {
  it('sends stopRecording method', async () => {
    const req = queueSuccessResponse({ success: true, data: {} })
    const { stopRecording } = await getModule()

    await stopRecording()

    expect(req.write).toHaveBeenCalledWith(
      expect.stringContaining('"method":"stopRecording"')
    )
  })
})

describe('Connection Resilience', () => {
  it('plugin drops connection mid-request - error propagates cleanly', async () => {
    mockRequest.mockImplementationOnce((opts, cb) => {
      const res = new EventEmitter()
      res.on('error', () => {})
      cb(res)
      res.emit('error', new Error('ECONNREFUSED'))
      return { end: vi.fn() }
    })
    const { callPlugin } = await getModule()

    await expect(callPlugin('getStatus')).rejects.toThrow()
  })
})
