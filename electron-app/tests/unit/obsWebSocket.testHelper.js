import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared call tracker for the mock OBS WebSocket instance
export const mockObsCall = vi.fn()
export const mockObsConnect = vi.fn()
export const mockObsDisconnect = vi.fn()

// obs-websocket-js exports a class (constructor). Use a proper class mock so
// `new OBSWebSocket()` works correctly inside obsWebSocket.js.
vi.mock('obs-websocket-js', () => {
  class MockOBSWebSocket {
    call(...args) {
      return mockObsCall(...args)
    }
    connect(...args) {
      return mockObsConnect(...args)
    }
    disconnect(...args) {
      return mockObsDisconnect(...args)
    }
  }
  return { default: MockOBSWebSocket }
})

beforeEach(async () => {
  // resetAllMocks clears implementations AND the once-queue, so leftover
  // mockResolvedValueOnce values from failing tests don't leak into the next test.
  vi.resetAllMocks()
  // Suppress expected console noise from error-path tests (e.g. "Failed to connect to OBS")
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockObsConnect.mockResolvedValue(undefined)
  mockObsDisconnect.mockResolvedValue(undefined)
  // Default behavior: return request-specific empty payloads so tests that don't
  // explicitly override the mock still get a sensible (non-crashing) default.
  mockObsCall.mockImplementation((requestType) => {
    switch (requestType) {
      case 'GetSceneList':
        return Promise.resolve({ scenes: [] })
      case 'GetSceneItemList':
        return Promise.resolve({ sceneItems: [] })
      case 'GetInputList':
        return Promise.resolve({ inputs: [] })
      default:
        return Promise.resolve(undefined)
    }
  })
  // Re-inject audio mocks each test so the injected withOBSConnection closes
  // over the freshly-reset mock functions (mockObsCall etc.).
  await injectAudioMocks()
})

// Modules are imported once and cached.  vi.mock('obs-websocket-js') is hoisted and
// applies at import time; vi.resetAllMocks() in beforeEach resets the shared mock
// functions (mockObsCall etc.) between tests, so the module instance can be reused.
// Imports are sequential so that obsWebSocket.js is fully cached before obsWsAudio.js
// runs its top-level require('./obsWebSocket').
let _moduleCache = null
export async function getModule() {
  if (!_moduleCache) {
    const ws = await import('../../electron/obsWebSocket.js')
    const audio = await import('../../electron/obsWsAudio.js')
    _moduleCache = { ...ws, ...audio }
  }
  return _moduleCache
}

// obsWsAudio.js loads obsWebSocket.js via CJS require(), which may resolve to a
// different module instance than the ESM import above — one whose dynamic
// import('obs-websocket-js') bypasses vi.mock's interception (native ESM loader).
// We work around this by injecting a mock withOBSConnection directly via the
// _inject() hook exported by obsWsAudio.js, wiring it to the same mockObsConnect
// / mockObsCall / mockObsDisconnect functions used by the rest of the test suite.
export async function injectAudioMocks() {
  const mod = await getModule()
  mod._inject({
    withOBSConnection: async (_wsSettings, callback) => {
      try {
        await mockObsConnect()
      } catch (err) {
        const code = err.code
        let msg = err.message || ''
        if (code === 1006 || msg.includes('1006')) {
          msg =
            'Cannot connect to OBS. Make sure OBS is running and WebSocket Server is enabled in Tools \u2192 WebSocket Server Settings.'
        } else if (msg.includes('authentication') || msg.includes('password')) {
          msg = 'Authentication failed. Check your WebSocket password in Settings.'
        } else if (msg.includes('timed out') || msg.includes('timeout')) {
          msg = 'Connection timed out. Verify OBS is running and the host/port are correct.'
        } else if (msg.includes('ECONNREFUSED') || msg.includes('refused')) {
          msg =
            'Connection refused. Check that OBS WebSocket Server is enabled and the port is correct.'
        }
        const wrapped = new Error(msg)
        wrapped.code = code
        throw wrapped
      }
      const obs = { call: mockObsCall, connect: mockObsConnect, disconnect: mockObsDisconnect }
      try {
        return await callback(obs)
      } finally {
        mockObsDisconnect().catch(() => {})
      }
    },
    fitSourceToCanvas: async (obs, sceneName, sceneItemId, videoSettings) => {
      if (sceneItemId == null) return
      try {
        const { baseWidth, baseHeight } = videoSettings ?? (await obs.call('GetVideoSettings'))
        await obs.call('SetSceneItemTransform', {
          sceneName,
          sceneItemId,
          sceneItemTransform: {
            positionX: 0,
            positionY: 0,
            alignment: 5,
            boundsType: 'OBS_BOUNDS_SCALE_INNER',
            boundsAlignment: 0,
            boundsWidth: baseWidth,
            boundsHeight: baseHeight,
          },
        })
      } catch {
        /* non-fatal */
      }
    },
  })
}
