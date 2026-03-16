/**
 * Unit tests for runElevated.js
 *
 * runElevated() is async and delegates to winUtils.runElevatedOps().
 * winUtils is mocked via require.cache injection (vi.mock only intercepts Vite's
 * ESM pipeline, not native require() calls inside CJS source files — see setup.js).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

// ── Inject mock into require.cache BEFORE runElevated.js loads winUtils ──────

const _runElevatedOpsMock = vi.fn()
const _winUtilsMock = {
  runElevatedOps:           _runElevatedOpsMock,
  getDiskFreeSpace:         vi.fn(),
  listWindowsWithProcesses: vi.fn(),
  listRunningApps:          vi.fn(),
  listAudioDevices:         vi.fn(),
  extractProcessIcon:       vi.fn(),
}

const _req = createRequire(import.meta.url)
const _winUtilsPath    = _req.resolve('../../electron/winUtils.js')
const _runElevatedPath = _req.resolve('../../electron/runElevated.js')

// Override (or create) the winUtils cache entry so require('./winUtils') returns our mock
_req.cache[_winUtilsPath] = {
  id: _winUtilsPath,
  filename: _winUtilsPath,
  loaded: true,
  exports: _winUtilsMock,
}

// Clear runElevated from cache so it re-requires and picks up the mocked winUtils
delete _req.cache[_runElevatedPath]

const { runElevated } = _req('../../electron/runElevated.js')

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('success path', () => {
  it('returns { success: true } from runElevatedOps', async () => {
    _runElevatedOpsMock.mockResolvedValue({ success: true })
    const result = await runElevated([{ type: 'mkdir', path: 'C:\\test' }])
    expect(result).toEqual({ success: true })
  })

  it('passes the ops array to runElevatedOps', async () => {
    _runElevatedOpsMock.mockResolvedValue({ success: true })
    const ops = [{ type: 'copy', src: 'C:\\src.dll', dest: 'C:\\dest.dll' }]
    await runElevated(ops)
    expect(_runElevatedOpsMock).toHaveBeenCalledWith(ops)
  })
})

describe('failure path', () => {
  it('returns { success: false, message } when runElevatedOps reports failure', async () => {
    _runElevatedOpsMock.mockResolvedValue({ success: false, message: 'UAC cancelled' })
    const result = await runElevated([])
    expect(result).toEqual({ success: false, message: 'UAC cancelled' })
  })

  it('returns { success: false, message } when runElevatedOps rejects', async () => {
    _runElevatedOpsMock.mockRejectedValue(new Error('koffi error'))
    const result = await runElevated([])
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/koffi error/)
  })
})

describe('multiple ops', () => {
  it('passes multiple ops through unchanged', async () => {
    _runElevatedOpsMock.mockResolvedValue({ success: true })
    const ops = [
      { type: 'mkdir', path: 'C:\\dir' },
      { type: 'copy',  src: 'C:\\a.dll', dest: 'C:\\b.dll' },
      { type: 'write', path: 'C:\\f.ini', content: '' },
    ]
    await runElevated(ops)
    expect(_runElevatedOpsMock).toHaveBeenCalledWith(ops)
  })
})
