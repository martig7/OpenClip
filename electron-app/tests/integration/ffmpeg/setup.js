/**
 * Setup for ffmpeg integration tests.
 * Mocks `electron` (so constants.js can call app.getPath / app.isPackaged)
 * but leaves child_process untouched — these tests run real ffmpeg/ffprobe.
 *
 * Uses Module._load interception (same technique as tests/setup.js for child_process)
 * rather than require.cache patching — the cache approach is bypassed by Vitest's
 * ESM/CJS module resolver in some environments (CI workers, fresh module contexts).
 */
import { createRequire } from 'module'
import { Module } from 'module'

const _req = createRequire(import.meta.url)
const electronMock = _req('../../../__mocks__/electron.js')

// Patch require.cache as a belt-and-suspenders fallback for direct CJS require calls
const electronPath = _req.resolve('electron')
_req.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: electronMock,
}

// Patch Module._load to intercept at the Node.js level regardless of caching
// (Vitest workers can have separate module contexts that bypass require.cache)
const _originalLoad = Module._load.bind(Module)
Module._load = function (request, parent, isMain) {
  if (request === 'electron' || request === 'node:electron') {
    return electronMock
  }
  return _originalLoad(request, parent, isMain)
}
