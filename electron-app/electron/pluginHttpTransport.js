/**
 * OpenClip OBS plugin — HTTP transport (no Electron).
 *
 * Used by `obsPlugin.js` and by integration tests via env overrides:
 *   - `OPENCLIP_PLUGIN_HTTP_PORT` — connect to this port (harness / manual debugging)
 *   - `OPENCLIP_PLUGIN_PORT_FILE` — read port from this path instead of the default runtime file
 */
const http = require('http')
const fs = require('fs')

const PORT_CACHE_MS = 3000
let cachedPort = null
let portReadTime = 0
let cachedFileKey = null

function invalidatePluginPortCache() {
  cachedPort = null
  portReadTime = 0
  cachedFileKey = null
}

/**
 * Resolve TCP port for the plugin HTTP API.
 * @param {string} [defaultPortFile] - Electron runtime `plugin_port` path (production default).
 * @returns {number|null}
 */
function resolvePluginPort(defaultPortFile) {
  const envPort = process.env.OPENCLIP_PLUGIN_HTTP_PORT
  if (envPort != null && String(envPort).trim() !== '') {
    const p = parseInt(String(envPort).trim(), 10)
    if (p > 0 && p < 65536) return p
  }

  const portFile =
    (process.env.OPENCLIP_PLUGIN_PORT_FILE && String(process.env.OPENCLIP_PLUGIN_PORT_FILE)) ||
    defaultPortFile
  if (!portFile) return null

  const now = Date.now()
  if (cachedPort && cachedFileKey === portFile && now - portReadTime < PORT_CACHE_MS) {
    return cachedPort
  }
  try {
    const raw = fs.readFileSync(portFile, 'utf-8').trim()
    const port = parseInt(raw, 10)
    if (port > 0 && port < 65536) {
      cachedPort = port
      portReadTime = now
      cachedFileKey = portFile
      return port
    }
  } catch {
    // missing file / unreadable
  }
  cachedPort = null
  cachedFileKey = null
  return null
}

const REQUEST_TIMEOUT_MS = 10000

function parsePluginError(err) {
  const msg = err.message || ''
  if (msg.includes('ECONNREFUSED') || msg.includes('refused')) {
    return 'Cannot connect to OpenClip OBS plugin. Make sure OBS is running with the plugin installed.'
  }
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'Plugin request timed out. OBS may be busy or unresponsive.'
  }
  if (msg.includes('ECONNRESET') || msg.includes('socket hang up')) {
    return 'Connection to OBS plugin was reset. OBS may have closed.'
  }
  return msg || 'Failed to communicate with OBS plugin'
}

/**
 * POST JSON `{ method, params }` to the plugin `/api` endpoint.
 * @param {number} port
 * @param {string} method
 * @param {object} [params]
 * @returns {Promise<any>} - Resolves with `data` on success.
 */
function callPluginHttp(port, method, params = {}) {
  const body = JSON.stringify({ method, params })

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            if (json.success) {
              resolve(json.data)
            } else {
              reject(new Error(json.error || 'Plugin returned an error'))
            }
          } catch {
            reject(new Error('Invalid response from OBS plugin'))
          }
        })
      }
    )
    req.on('error', (err) => {
      invalidatePluginPortCache()
      reject(new Error(parsePluginError(err)))
    })
    req.on('timeout', () => {
      invalidatePluginPortCache()
      req.destroy()
      reject(new Error('Plugin request timed out'))
    })
    req.write(body)
    req.end()
  })
}

module.exports = {
  resolvePluginPort,
  callPluginHttp,
  invalidatePluginPortCache,
}
