/**
 * OpenClip OBS plugin — HTTP transport (no Electron).
 *
 * Used by `obsPlugin.js` and by integration tests via env overrides:
 *   - `OPENCLIP_PLUGIN_HTTP_PORT` — connect to this port (harness / manual debugging)
 *   - `OPENCLIP_PLUGIN_PORT_FILE` — read port from this path instead of the default runtime file
 */
const http = require('http')
const fs = require('fs')

/** Try IPv4, IPv6 loopback, then localhost (DNS) — plugin may bind one stack only. */
const PLUGIN_HTTP_HOSTS = ['127.0.0.1', '::1', 'localhost']

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
 * Poll until the plugin HTTP server answers `getStatus` (port file can appear
 * before the server is listening).
 * @param {number} port
 * @param {{ timeoutMs?: number, intervalMs?: number }} [opts]
 */
async function waitForPluginHttpReady(port, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000
  const intervalMs = opts.intervalMs ?? 250
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      await callPluginHttp(port, 'getStatus', {})
      return
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  throw new Error(
    `Plugin HTTP did not become ready on port ${port} within ${timeoutMs}ms` +
      (lastErr ? `: ${lastErr.message}` : '')
  )
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
  if (portFile) {
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

function shouldRetryPluginHttpTransport(err) {
  if (err && err.pluginHttpError) return false
  const code = err && err.code
  if (
    code === 'ECONNREFUSED' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET'
  ) {
    return true
  }
  const msg = String((err && err.message) || '').toLowerCase()
  return (
    msg.includes('refused') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('reset')
  )
}

/**
 * POST JSON `{ method, params }` to the plugin `/api` endpoint.
 * @param {number} port
 * @param {string} method
 * @param {object} [params]
 * @returns {Promise<any>} - Resolves with `data` on success.
 */
async function callPluginHttp(port, method, params = {}) {
  const body = JSON.stringify({ method, params })
  let lastErr = null
  for (const hostname of PLUGIN_HTTP_HOSTS) {
    try {
      return await callPluginHttpRaw(hostname, port, body)
    } catch (err) {
      lastErr = err
      if (shouldRetryPluginHttpTransport(err)) continue
      throw new Error(parsePluginError(err))
    }
  }
  throw new Error(parsePluginError(lastErr))
}

/**
 * Single-host POST — rejects with raw connection errors (for retry loop).
 * @param {string} hostname
 * @param {number} port
 * @param {string} body
 */
function callPluginHttpRaw(hostname, port, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname,
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
              const e = new Error(json.error || 'Plugin returned an error')
              e.pluginHttpError = true
              reject(e)
            }
          } catch {
            const e = new Error('Invalid response from OBS plugin')
            e.pluginHttpError = true
            reject(e)
          }
        })
      }
    )
    req.on('error', (err) => {
      invalidatePluginPortCache()
      reject(err)
    })
    req.on('timeout', () => {
      invalidatePluginPortCache()
      req.destroy()
      const e = new Error('Plugin request timed out')
      e.code = 'ETIMEDOUT'
      reject(e)
    })
    req.write(body)
    req.end()
  })
}

module.exports = {
  resolvePluginPort,
  callPluginHttp,
  invalidatePluginPortCache,
  waitForPluginHttpReady,
}
