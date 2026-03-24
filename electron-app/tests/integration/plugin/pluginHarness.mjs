/**
 * OpenClip OBS plugin — in-process mock HTTP server (contract / harness).
 *
 * Implements the same wire protocol as the native plugin:
 *   POST /api  Content-Type: application/json
 *   Body: { "method": string, "params": object }
 *   Response: { "success": true, "data": any } | { "success": false, "error": string }
 *
 * Use with `electron/pluginHttpTransport.js`:
 *   process.env.OPENCLIP_PLUGIN_HTTP_PORT = String(server.port)
 *
 * For the **real** DLL, run OBS with the plugin; the harness is for CI and fast
 * contract tests without loading OBS.
 */
import http from 'http'

/**
 * @typedef {Record<string, (params: object, ctx: object) => any | Promise<any>>} PluginMethodHandlers
 */

/**
 * @param {PluginMethodHandlers} [handlers] - Override or extend default methods
 * @returns {Promise<{
 *   port: number,
 *   address: string,
 *   server: import('http').Server,
 *   stop: () => Promise<void>,
 *   state: object,
 * }>}
 */
export async function startMockOpenClipPluginServer(handlers = {}) {
  const state = {
    /** @type {Record<string, Record<string, boolean>>} */
    inputAudioTracks: {},
    scenes: ['Scene'],
  }

  const defaults = {
    getStatus() {
      return {
        obsVersion: 'mock',
        pluginVersion: 'harness',
      }
    },
    getScenes() {
      return state.scenes
    },
    getInputAudioTracks(params) {
      const inputName = params?.inputName
      if (!inputName) throw new Error('inputName is required')
      const existing = state.inputAudioTracks[inputName]
      const base = existing || {
        '1': true,
        '2': true,
        '3': true,
        '4': true,
        '5': true,
        '6': true,
      }
      // Match native plugin: `data` is a flat map of track index -> enabled
      return { ...base }
    },
    setInputAudioTracks(params) {
      const inputName = params?.inputName
      const tracks = params?.tracks
      if (!inputName) throw new Error('inputName is required')
      if (!tracks || typeof tracks !== 'object') throw new Error('tracks is required')
      state.inputAudioTracks[inputName] = { ...tracks }
      return null
    },
    getSceneAudioSources(params) {
      const sceneName = params?.sceneName
      if (!sceneName) return []
      return []
    },
    getAudioInputs() {
      return []
    },
    getTrackNames() {
      return ['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6']
    },
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api') {
      res.statusCode = 404
      res.end()
      return
    }
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json')
      try {
        const parsed = JSON.parse(body || '{}')
        const method = parsed.method
        const params = parsed.params || {}
        const fn = handlers[method] || defaults[method]
        if (!fn) {
          res.statusCode = 200
          res.end(JSON.stringify({ success: false, error: `Unknown method: ${method}` }))
          return
        }
        const data = await fn(params, state)
        res.statusCode = 200
        res.end(JSON.stringify({ success: true, data }))
      } catch (err) {
        res.statusCode = 200
        res.end(
          JSON.stringify({
            success: false,
            error: err?.message || String(err),
          })
        )
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  return {
    port,
    address: `127.0.0.1:${port}`,
    server,
    state,
    stop() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}
