/**
 * OpenClip native plugin — HTTP contract tests (in-process mock).
 *
 * Does not load OBS or the real DLL. For live OBS + WebSocket, see
 * `tests/integration/obs/obsOrchestration.test.js`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'module'
import { startMockOpenClipPluginServer } from './pluginHarness.mjs'

const require = createRequire(import.meta.url)
const {
  callPluginHttp,
  resolvePluginPort,
  invalidatePluginPortCache,
} = require('../../../electron/pluginHttpTransport.js')

describe('OpenClip plugin harness (mock HTTP server)', () => {
  let mock

  beforeAll(async () => {
    mock = await startMockOpenClipPluginServer()
    process.env.OPENCLIP_PLUGIN_HTTP_PORT = String(mock.port)
    invalidatePluginPortCache()
  })

  afterAll(async () => {
    delete process.env.OPENCLIP_PLUGIN_HTTP_PORT
    invalidatePluginPortCache()
    await mock.stop()
  })

  it('resolvePluginPort() honors OPENCLIP_PLUGIN_HTTP_PORT', () => {
    const port = resolvePluginPort('/this/path/is/ignored/when/env/set')
    expect(port).toBe(mock.port)
  })

  it('getStatus returns data the renderer can consume', async () => {
    const data = await callPluginHttp(mock.port, 'getStatus', {})
    expect(data).toHaveProperty('obsVersion')
    expect(data).toHaveProperty('pluginVersion')
  })

  it('getInputAudioTracks / setInputAudioTracks round-trip per input name', async () => {
    const inputName = 'Game Audio (Fullscreen test.exe)'
    await callPluginHttp(mock.port, 'setInputAudioTracks', {
      inputName,
      tracks: {
        '1': true,
        '2': true,
        '3': true,
        '4': false,
        '5': true,
        '6': true,
      },
    })
    const tracks = await callPluginHttp(mock.port, 'getInputAudioTracks', { inputName })
    expect(tracks['4']).toBe(false)
    expect(tracks['1']).toBe(true)
  })

  it('unknown method returns success:false with error (wire format)', async () => {
    await expect(callPluginHttp(mock.port, 'noSuchMethod', {})).rejects.toThrow(/Unknown method|Plugin returned an error/)
  })
})
