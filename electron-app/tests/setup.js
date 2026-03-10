import { vi } from 'vitest'
import { createRequire } from 'module'

// ─── Electron mock ──────────────────────────────────────────────────────────
// Inject directly into Node's CJS require cache so that CJS backend files
// that call require('electron') at module-load time get our mock.
// (vi.mock() only intercepts Vite's ESM pipeline, not native require().)

const _req = createRequire(import.meta.url)
const _electronPath = _req.resolve('electron')

// Load the single canonical mock from __mocks__/electron.js
// Path is relative to this file (electron-app/tests/setup.js):
// '../' goes to electron-app/, then '__mocks__/electron.js' is the target.
const _electronMock = _req('../__mocks__/electron.js')

_req.cache[_electronPath] = {
  id: _electronPath,
  filename: _electronPath,
  loaded: true,
  exports: _electronMock,
}

// Also mock via Vitest for ESM imports (component tests etc.)
vi.mock('electron', () => ({ default: _electronMock, ..._electronMock }))

// ─── child_process mock ──────────────────────────────────────────────────────
// Built-in modules bypass require.cache, so we patch Module._load directly.
// This intercepts require('child_process') in CJS source files (recordingService.js,
// fileManager.js, apiServer.js etc.) so they receive vi.fn() stubs.

import { Module } from 'module'

export const _cpMock = {
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}

const _originalLoad = Module._load.bind(Module)
Module._load = function (request, parent, isMain) {
  if (request === 'child_process' || request === 'node:child_process') {
    return _cpMock
  }
  return _originalLoad(request, parent, isMain)
}

// Also register for ESM imports
vi.mock('child_process', () => ({ default: _cpMock, ..._cpMock }))
