/**
 * Unit tests for elevatedHelper.js
 *
 * elevatedHelper.run() reads process.argv for --param-file and --result-file,
 * performs filesystem ops, writes a result JSON, then calls process.exit().
 * process.exit is mocked so the process does not actually terminate.
 *
 * All tests use a real temporary directory — no mocking of fs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createRequire } from 'module'

// Load elevatedHelper as CJS (same as the source file)
const _req = createRequire(import.meta.url)
const { run } = _req('../../electron/elevatedHelper.js')

let tmpDir
let origArgv

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-helper-'))
  origArgv = process.argv
  vi.spyOn(process, 'exit').mockImplementation(() => {})
})

afterEach(() => {
  process.argv = origArgv
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeParams(ops, paramFile, resultFile) {
  fs.writeFileSync(paramFile, JSON.stringify({ ops, resultFile }), 'utf-8')
}

function invoke(paramFile, resultFile) {
  process.argv = ['node', 'main.js', `--param-file=${paramFile}`, `--result-file=${resultFile}`]
  run()
}

function readResult(resultFile) {
  return JSON.parse(fs.readFileSync(resultFile, 'utf-8'))
}

// ── mkdir op ─────────────────────────────────────────────────────────────────

describe('mkdir op', () => {
  it('creates the target directory (recursive)', () => {
    const target = path.join(tmpDir, 'sub', 'nested')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    writeParams([{ type: 'mkdir', path: target }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    expect(fs.existsSync(target)).toBe(true)
    expect(fs.statSync(target).isDirectory()).toBe(true)
  })

  it('writes { success: true } to the result file', () => {
    const target = path.join(tmpDir, 'newdir')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    writeParams([{ type: 'mkdir', path: target }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    expect(readResult(resultFile)).toEqual({ success: true })
  })

  it('deletes the param file on success', () => {
    const target = path.join(tmpDir, 'newdir')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    writeParams([{ type: 'mkdir', path: target }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    expect(fs.existsSync(paramFile)).toBe(false)
  })

  it('calls process.exit(0) on success', () => {
    const target = path.join(tmpDir, 'newdir')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    writeParams([{ type: 'mkdir', path: target }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    expect(process.exit).toHaveBeenCalledWith(0)
  })
})

// ── copy op ───────────────────────────────────────────────────────────────────

describe('copy op', () => {
  it('copies a file and creates missing parent directories', () => {
    const src = path.join(tmpDir, 'source.dll')
    const dest = path.join(tmpDir, 'plugins', '64bit', 'target.dll')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    const content = Buffer.alloc(256, 0xbe)
    fs.writeFileSync(src, content)
    writeParams([{ type: 'copy', src, dest }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    expect(fs.existsSync(dest)).toBe(true)
    expect(fs.readFileSync(dest)).toEqual(content)
  })

  it('writes { success: true }', () => {
    const src = path.join(tmpDir, 'source.dll')
    const dest = path.join(tmpDir, 'out', 'target.dll')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    fs.writeFileSync(src, Buffer.alloc(64))
    writeParams([{ type: 'copy', src, dest }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    expect(readResult(resultFile)).toEqual({ success: true })
  })
})

// ── delete op ─────────────────────────────────────────────────────────────────

describe('delete op', () => {
  it('deletes an existing file', () => {
    const target = path.join(tmpDir, 'to-delete.dll')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    fs.writeFileSync(target, Buffer.alloc(64))
    writeParams([{ type: 'delete', path: target }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    expect(fs.existsSync(target)).toBe(false)
  })

  it('deletes a directory tree when recursive is true', () => {
    const target = path.join(tmpDir, 'to-delete-dir')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    fs.mkdirSync(path.join(target, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(target, 'file.txt'), 'hello')
    writeParams([{ type: 'delete', path: target, recursive: true }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    expect(fs.existsSync(target)).toBe(false)
  })

  it('is a no-op on a non-existent path (force mode) and still succeeds', () => {
    const target = path.join(tmpDir, 'does-not-exist.dll')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    writeParams([{ type: 'delete', path: target }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    expect(readResult(resultFile)).toEqual({ success: true })
  })
})

// ── write op ──────────────────────────────────────────────────────────────────

describe('write op', () => {
  it('creates a file with the specified content, creating parent dirs', () => {
    const target = path.join(tmpDir, 'locale', 'en-US', 'plugin.ini')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    writeParams(
      [{ type: 'write', path: target, content: 'Name=TestPlugin' }],
      paramFile,
      resultFile
    )

    invoke(paramFile, resultFile)

    expect(fs.existsSync(target)).toBe(true)
    expect(fs.readFileSync(target, 'utf-8')).toBe('Name=TestPlugin')
  })

  it('creates a file with empty content when content is omitted', () => {
    const target = path.join(tmpDir, 'empty.ini')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    writeParams([{ type: 'write', path: target }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    expect(fs.existsSync(target)).toBe(true)
    expect(fs.readFileSync(target, 'utf-8')).toBe('')
  })
})

// ── multiple ops ─────────────────────────────────────────────────────────────

describe('multiple ops — OBS plugin install sequence', () => {
  it('executes mkdir → copy → write in order and writes success', () => {
    const pluginDir = path.join(tmpDir, 'obs-plugins', '64bit')
    const localeDir = path.join(tmpDir, 'obs-plugins', 'locale')
    const src = path.join(tmpDir, 'plugin.dll')
    const dest = path.join(pluginDir, 'plugin.dll')
    const localeFile = path.join(localeDir, 'en-US.ini')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')

    fs.writeFileSync(src, Buffer.alloc(128, 0xde))
    writeParams(
      [
        { type: 'mkdir', path: pluginDir },
        { type: 'copy', src, dest },
        { type: 'mkdir', path: localeDir },
        { type: 'write', path: localeFile, content: '' },
      ],
      paramFile,
      resultFile
    )

    invoke(paramFile, resultFile)

    expect(fs.existsSync(dest)).toBe(true)
    expect(fs.readFileSync(dest)).toEqual(fs.readFileSync(src))
    expect(fs.existsSync(localeFile)).toBe(true)
    expect(readResult(resultFile)).toEqual({ success: true })
  })

  it('executes delete ops — OBS plugin remove sequence', () => {
    const pluginDll = path.join(tmpDir, 'obs-plugins', '64bit', 'plugin.dll')
    const localeDir = path.join(tmpDir, 'obs-plugins', 'locale', 'en-US')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')

    fs.mkdirSync(path.dirname(pluginDll), { recursive: true })
    fs.mkdirSync(localeDir, { recursive: true })
    fs.writeFileSync(pluginDll, Buffer.alloc(64))
    fs.writeFileSync(path.join(localeDir, 'en-US.ini'), '')
    writeParams(
      [
        { type: 'delete', path: pluginDll },
        { type: 'delete', path: localeDir, recursive: true },
      ],
      paramFile,
      resultFile
    )

    invoke(paramFile, resultFile)

    expect(fs.existsSync(pluginDll)).toBe(false)
    expect(fs.existsSync(localeDir)).toBe(false)
    expect(readResult(resultFile)).toEqual({ success: true })
  })
})

// ── error cases ───────────────────────────────────────────────────────────────

describe('error cases', () => {
  it('writes { success: false, message } for an unknown op type', () => {
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    writeParams([{ type: 'unsupported_op', path: '/tmp/foo' }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    const result = readResult(resultFile)
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/Unknown op type/)
  })

  it('calls process.exit(1) when --param-file is missing', () => {
    // When paramFile is missing, run() calls process.exit(1) before anything else.
    // Since process.exit is mocked (no real exit), execution falls through to the
    // try block which also errors — so we only assert on the exit code, not the message.
    process.argv = ['node', 'main.js', `--result-file=${path.join(tmpDir, 'result.json')}`]

    run()

    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('writes { success: false, message } when the param file does not exist', () => {
    const paramFile = path.join(tmpDir, 'nonexistent-params.json')
    const resultFile = path.join(tmpDir, 'result.json')

    invoke(paramFile, resultFile)

    const result = readResult(resultFile)
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/ENOENT|no such file/i)
  })

  it('writes { success: false, message } when copying a non-existent source', () => {
    const src = path.join(tmpDir, 'missing.dll')
    const dest = path.join(tmpDir, 'out', 'missing.dll')
    const paramFile = path.join(tmpDir, 'params.json')
    const resultFile = path.join(tmpDir, 'result.json')
    writeParams([{ type: 'copy', src, dest }], paramFile, resultFile)

    invoke(paramFile, resultFile)

    const result = readResult(resultFile)
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/ENOENT|no such file/i)
  })
})
