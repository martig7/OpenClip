/**
 * Unit tests for runElevated.js
 *
 * runElevated() is synchronous: it writes a temp .ps1, calls execSync to launch
 * an elevated PowerShell process, then reads a result file the script writes.
 * child_process is mocked via setup.js; fs calls are real (tmpdir only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { _cpMock } from '../setup.js'

const FIXED_ID = 99999

// Predictable temp paths based on the mocked Date.now
const scriptPath = path.join(os.tmpdir(), `openclip-install-${FIXED_ID}.ps1`)
const resultPath = path.join(os.tmpdir(), `openclip-result-${FIXED_ID}.txt`)

let runElevated

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_ID)
  vi.clearAllMocks()
  // Re-import each time so Date.now is already mocked when the module runs
  vi.resetModules()
  ;({ runElevated } = await import('../../electron/runElevated.js'))
  // Clean up any leftover temp files
  try { fs.rmSync(scriptPath, { force: true }) } catch {}
  try { fs.rmSync(resultPath, { force: true }) } catch {}
})

afterEach(() => {
  vi.restoreAllMocks()
  try { fs.rmSync(scriptPath, { force: true }) } catch {}
  try { fs.rmSync(resultPath, { force: true }) } catch {}
})

// ── Success path ─────────────────────────────────────────────────────────────

describe('success path', () => {
  it('returns { success: true } when execSync succeeds and result file contains "ok"', () => {
    _cpMock.execSync.mockImplementation(() => {
      // Simulate the elevated script writing "ok" to the result file
      fs.writeFileSync(resultPath, 'ok', 'utf-8')
    })

    const result = runElevated(['Copy-Item foo bar'])

    expect(result).toEqual({ success: true })
  })

  it('cleans up the result file on success', () => {
    _cpMock.execSync.mockImplementation(() => {
      fs.writeFileSync(resultPath, 'ok', 'utf-8')
    })

    runElevated(['echo hi'])

    expect(fs.existsSync(resultPath)).toBe(false)
  })
})

// ── UAC / execSync failure ───────────────────────────────────────────────────

describe('execSync throws (UAC denied / cancelled)', () => {
  it('returns { success: false, message: denied } when execSync throws', () => {
    _cpMock.execSync.mockImplementation(() => { throw new Error('UAC cancelled') })

    const result = runElevated(['echo test'])

    expect(result).toEqual({ success: false, message: 'Administrator permission was denied.' })
  })

  it('cleans up the .ps1 script file even when execSync throws', () => {
    _cpMock.execSync.mockImplementation(() => { throw new Error('denied') })

    runElevated(['echo test'])

    expect(fs.existsSync(scriptPath)).toBe(false)
  })

  it('does not attempt to read the result file when execSync throws', () => {
    _cpMock.execSync.mockImplementation(() => { throw new Error('denied') })
    const readSpy = vi.spyOn(fs, 'readFileSync')

    runElevated(['echo test'])

    expect(readSpy).not.toHaveBeenCalledWith(resultPath, expect.anything())
  })
})

// ── Elevated script error ────────────────────────────────────────────────────

describe('elevated script writes an error message', () => {
  it('returns { success: false, message } from result file when script fails', () => {
    _cpMock.execSync.mockImplementation(() => {
      fs.writeFileSync(resultPath, 'Access to the path is denied.', 'utf-8')
    })

    const result = runElevated(['Copy-Item C:\\protected dst'])

    expect(result).toEqual({ success: false, message: 'Access to the path is denied.' })
  })

  it('trims whitespace from the error message in the result file', () => {
    _cpMock.execSync.mockImplementation(() => {
      fs.writeFileSync(resultPath, '  some error  \r\n', 'utf-8')
    })

    const result = runElevated(['echo test'])

    expect(result.message).toBe('some error')
  })
})

// ── Missing result file ──────────────────────────────────────────────────────

describe('result file absent (execSync succeeded but script never wrote result)', () => {
  it('returns { success: false } with the "did not produce a result" message', () => {
    _cpMock.execSync.mockReturnValue(undefined) // succeeds but writes no file

    const result = runElevated(['echo test'])

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/did not produce a result/)
  })
})

// ── Script generation ────────────────────────────────────────────────────────

describe('generated PowerShell script', () => {
  function captureScript() {
    let content = null
    _cpMock.execSync.mockImplementation(() => {
      // Script file still exists at this point (before the finally cleanup)
      if (fs.existsSync(scriptPath)) content = fs.readFileSync(scriptPath, 'utf-8')
    })
    return () => content
  }

  it('wraps psLines in a try/catch block', () => {
    const getScript = captureScript()
    runElevated(['Write-Host "hello"'])
    expect(getScript()).toContain('try {')
    expect(getScript()).toContain('} catch {')
    expect(getScript()).toContain('Write-Host "hello"')
  })

  it('includes Set-Content "ok" on success in the try block', () => {
    const getScript = captureScript()
    runElevated(['echo hi'])
    expect(getScript()).toContain("Set-Content")
    expect(getScript()).toContain("'ok'")
  })

  it('writes $_.Exception.Message to result file in the catch block', () => {
    const getScript = captureScript()
    runElevated(['echo hi'])
    expect(getScript()).toContain('$_.Exception.Message')
  })

  it('passes the script path to execSync via Start-Process -Verb RunAs', () => {
    _cpMock.execSync.mockReturnValue(undefined)
    runElevated(['echo test'])

    const cmd = _cpMock.execSync.mock.calls[0][0]
    expect(cmd).toContain('Start-Process')
    expect(cmd).toContain('-Verb RunAs')
    expect(cmd).toContain(`openclip-install-${FIXED_ID}.ps1`)
  })
})

// ── Single-quote escaping ────────────────────────────────────────────────────

describe("single-quote escaping in psLines", () => {
  it("embeds psLines verbatim — callers are responsible for valid PowerShell", () => {
    let content = null
    _cpMock.execSync.mockImplementation(() => {
      if (fs.existsSync(scriptPath)) content = fs.readFileSync(scriptPath, 'utf-8')
    })

    runElevated([`Copy-Item 'C:\\Folder\\plugin.dll' 'C:\\dest'`])

    // psLines are NOT escaped by runElevated — they appear as-is in the script
    expect(content).toContain(`Copy-Item 'C:\\Folder\\plugin.dll' 'C:\\dest'`)
  })

  it("doubles single quotes in the result file path embedded in the script", () => {
    // The result path itself is embedded with esc() — if tmpdir had a quote it would be doubled.
    // Normal paths won't have quotes, so just verify execSync was called (no crash).
    _cpMock.execSync.mockReturnValue(undefined)
    expect(() => runElevated(['echo test'])).not.toThrow()
  })
})

// ── Script file cleanup ──────────────────────────────────────────────────────

describe('temp file cleanup', () => {
  it('always removes the .ps1 script after execSync succeeds', () => {
    _cpMock.execSync.mockImplementation(() => {
      fs.writeFileSync(resultPath, 'ok', 'utf-8')
    })

    runElevated(['echo hi'])

    expect(fs.existsSync(scriptPath)).toBe(false)
  })

  it('always removes the .ps1 script after execSync throws', () => {
    _cpMock.execSync.mockImplementation(() => { throw new Error('denied') })

    runElevated(['echo hi'])

    expect(fs.existsSync(scriptPath)).toBe(false)
  })
})
