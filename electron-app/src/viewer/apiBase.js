// Provides the base URL for API calls to the local API server.
// In Electron, the API server runs on a random port.
// In dev (vite), requests are proxied via vite config.

let _base = '';
let _resolved = false;
let _resolvePromise;
const _ready = new Promise(r => _resolvePromise = r);

async function init() {
  if (_resolved) return;
  if (window.api?.getApiPort) {
    // In Electron - get the port from main process
    const port = await window.api.getApiPort();
    if (port) _base = `http://127.0.0.1:${port}`;
  }
  // In browser dev mode, _base stays '' (vite proxy handles /api)
  _resolved = true;
  _resolvePromise();
}

// Start init immediately
init();

export async function apiUrl(path) {
  await _ready;
  return `${_base}${path}`;
}

export async function apiFetch(path, options) {
  const url = await apiUrl(path);
  return fetch(url, options);
}

export async function apiPost(path, data) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// Synchronous getter for video src URLs (for <video> elements)
// Falls back to relative path if port not yet known
export function getBase() {
  return _base;
}

export { _ready as ready };
