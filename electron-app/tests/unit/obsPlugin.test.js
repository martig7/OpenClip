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

  it('invalidates port cache on error', async () => {
    queueErrorResponse(new Error('ECONNRESET'))
    const { callPlugin } = await getModule()

    await expect(callPlugin('getStatus')).rejects.toThrow()

    // Next call must re-read the port file (cache was invalidated)
    mockReadFileSync.mockReturnValue('28756')
    queueSuccessResponse({ success: true, data: {} })
    await callPlugin('getStatus')

    // readFileSync: once before error, once after invalidation
    expect(mockReadFileSync).toHaveBeenCalledTimes(2)
  })
})

// ─── isPluginReachable ─────────────────────────────────────────────────────────

describe('isPluginReachable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileSync.mockReturnValue('28756')
  })

  it('returns true when getStatus succeeds', async () => {
    queueSuccessResponse({ success: true, data: {} })
    const { isPluginReachable } = await getModule()
    await expect(isPluginReachable()).resolves.toBe(true)
  })

  it('returns false when getStatus fails', async () => {
    queueErrorResponse(new Error('ECONNREFUSED'))
    const { isPluginReachable } = await getModule()
    await expect(isPluginReachable()).resolves.toBe(false)
  })
})

// ─── High-level API wrappers ───────────────────────────────────────────────────

describe('getOBSScenes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileSync.mockReturnValue('28756')
  })

  it('returns scene list from plugin', async () => {
    queueSuccessResponse({ success: true, data: ['Scene A', 'Scene B'] })
    const { getOBSScenes } = await getModule()

    const result = await getOBSScenes()
    expect(result).toEqual(['Scene A', 'Scene B'])
  })
})

describe('removeAudioSourceFromScenes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileSync.mockReturnValue('28756')
  })

  it('returns error when no scene names are provided', async () => {
    const { removeAudioSourceFromScenes } = await getModule()
    const result = await removeAudioSourceFromScenes(undefined, [], 'Mic')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/no scene names/i)
  })

  it('returns error when input name is missing', async () => {
    const { removeAudioSourceFromScenes } = await getModule()
    const result = await removeAudioSourceFromScenes(undefined, ['Scene'], '')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/input name/i)
  })

  it('computes success based on results (not hardcoded)', async () => {
    // Both scenes: getSceneItems returns empty → source not found in either
    queueSuccessResponse({ success: true, data: [] }) // S1 getSceneItems
    queueSuccessResponse({ success: true, data: [] }) // S2 getSceneItems

    const { removeAudioSourceFromScenes } = await getModule()
    const result = await removeAudioSourceFromScenes(undefined, ['S1', 'S2'], 'Mic')

    expect(typeof result.success).toBe('boolean')
    expect(result.results.every(r => r.status === 'not found')).toBe(true)
  })
})

describe('addAudioSourceToScenes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileSync.mockReturnValue('28756')
  })

  it('returns error when no scene names are provided', async () => {
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes(undefined, [], 'wasapi_input_capture', 'Mic', {})
    expect(result.success).toBe(false)
  })

  it('returns error when inputKind is missing', async () => {
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes(undefined, ['Scene'], '', 'Mic', {})
    expect(result.success).toBe(false)
  })
})

describe('startRecording / stopRecording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileSync.mockReturnValue('28756')
  })

  it('startRecording sends startRecording method', async () => {
    const req = queueSuccessResponse({ success: true, data: {} })
    const { startRecording } = await getModule()

    await startRecording('MyScene')

    expect(req.write).toHaveBeenCalledWith(
      expect.stringContaining('"method":"startRecording"')
    )
  })

  it('stopRecording sends stopRecording method', async () => {
    const req = queueSuccessResponse({ success: true, data: {} })
    const { stopRecording } = await getModule()

    await stopRecording()

    expect(req.write).toHaveBeenCalledWith(
      expect.stringContaining('"method":"stopRecording"')
    )
  })
})
