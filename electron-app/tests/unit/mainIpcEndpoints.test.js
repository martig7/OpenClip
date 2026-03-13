import fs from 'fs'
import path from 'path'
import os from 'os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { _cpMock } from '../setup.js'

const req = createRequire(import.meta.url)
const electronMock = req('../../__mocks__/electron.js')
const mainPath = req.resolve('../../electron/main.js')
const detectorPath = req.resolve('../../electron/processDetector.js')
const autoUpdaterPath = req.resolve('../../electron/autoUpdater.js')
const elevatedRunnerPath = req.resolve('../../electron/elevatedRunner.js')
const elevatedHelperPath = req.resolve('../../electron/elevatedHelper.js')

const defaultDetectorMock = {
  getVisibleWindowsDetailed:  () => [],
  getRunningProcessesDetailed: () => [],
  getRunningProcessNames:      () => [],   // used by isOBSRunning() in obsEncoding.js
  findProcessPathByName:       () => '',
}

function loadMain({ detectorMock = defaultDetectorMock, elevatedRunnerMock } = {}) {
  delete req.cache[mainPath]
  delete req.cache[detectorPath]
  delete req.cache[autoUpdaterPath]
  if (elevatedRunnerMock) delete req.cache[elevatedRunnerPath]

  req.cache[autoUpdaterPath] = {
    id: autoUpdaterPath,
    filename: autoUpdaterPath,
    loaded: true,
    exports: {
      setupAutoUpdater: () => {},
      setupDevAutoUpdater: () => {},
      devCheckAndDownload: async () => false,
      registerUpdateHandlers: () => {},
    },
  }

  req.cache[detectorPath] = {
    id: detectorPath,
    filename: detectorPath,
    loaded: true,
    exports: detectorMock,
  }

  if (elevatedRunnerMock) {
    req.cache[elevatedRunnerPath] = {
      id: elevatedRunnerPath,
      filename: elevatedRunnerPath,
      loaded: true,
      exports: elevatedRunnerMock,
    }
  }

  electronMock.ipcMain.__resetHandlers()
  req(mainPath)
}

// ── Phase 1: windows endpoints (koffi-based, no PowerShell) ──────────────────

describe('main IPC windows endpoints', () => {
  beforeEach(() => {
    _cpMock.exec.mockReset()
    _cpMock.execFile.mockReset()
    _cpMock.execSync.mockReset()
    _cpMock.execFileSync.mockReset()
    _cpMock.spawn.mockReset()
  })

  it('registers windows IPC handlers', () => {
    loadMain()
    expect(typeof electronMock.ipcMain.__getHandler('windows:list')).toBe('function')
    expect(typeof electronMock.ipcMain.__getHandler('windows:list-running-apps')).toBe('function')
    expect(typeof electronMock.ipcMain.__getHandler('windows:list-audio-devices')).toBe('function')
    expect(typeof electronMock.ipcMain.__getHandler('windows:extractIcon')).toBe('function')
  })

  it('windows:list filters system processes and preserves shape', async () => {
    loadMain({
      detectorMock: {
        getVisibleWindowsDetailed: () => ([
          { title: 'File Explorer', process: 'explorer', exe: 'explorer.exe', windowClass: 'CabinetWClass' },
          { title: 'Game Window', process: 'game', exe: 'game.exe', windowClass: 'UnrealWindow' },
        ]),
        getRunningProcessesDetailed: () => [],
        findProcessPathByName: () => '',
      },
    })

    const handler = electronMock.ipcMain.__getHandler('windows:list')
    const windows = await handler()

    expect(windows).toEqual([
      { title: 'Game Window', process: 'game', exe: 'game.exe', windowClass: 'UnrealWindow' },
    ])
  })

  it('windows:list-running-apps filters low-level processes and dedupes by name', async () => {
    loadMain({
      detectorMock: {
        getVisibleWindowsDetailed: () => [],
        getRunningProcessesDetailed: () => ([
          { name: 'svchost', exe: 'svchost.exe', hasWindow: false },
          { name: '[system process]', exe: '[System Process]', hasWindow: false },
          { name: 'discord', exe: 'Discord.exe', hasWindow: false },
          { name: 'discord', exe: 'Discord.exe', hasWindow: true },
          { name: 'steam', exe: 'steam.exe', hasWindow: false },
        ]),
        findProcessPathByName: () => '',
      },
    })

    const handler = electronMock.ipcMain.__getHandler('windows:list-running-apps')
    const apps = await handler()

    expect(apps).toEqual([
      { name: 'discord', exe: 'Discord.exe', hasWindow: true },
      { name: 'steam', exe: 'steam.exe', hasWindow: false },
    ])
  })

  it('windows:extractIcon writes icon PNG when process path is available', async () => {
    const tmpExe = path.join(process.cwd(), 'tests', 'fixtures', 'tmp-game.exe')
    fs.mkdirSync(path.dirname(tmpExe), { recursive: true })
    fs.writeFileSync(tmpExe, 'binary')

    loadMain({
      detectorMock: {
        getVisibleWindowsDetailed: () => [],
        getRunningProcessesDetailed: () => [],
        findProcessPathByName: (name) => (name === 'game' ? tmpExe : ''),
      },
    })

    const handler = electronMock.ipcMain.__getHandler('windows:extractIcon')
    const iconPath = await handler({}, 'game')

    expect(iconPath).toBeTruthy()
    expect(fs.existsSync(iconPath)).toBe(true)

    if (iconPath && fs.existsSync(iconPath)) fs.rmSync(iconPath, { force: true })
    fs.rmSync(tmpExe, { force: true })
  })

  it('windows:list-audio-devices parses capture and render endpoints from registry output', async () => {
    loadMain()

    _cpMock.execFile
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, [
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render\\{AAA}',
        '    FriendlyName    REG_SZ    Speakers (USB DAC)',
      ].join('\r\n')))
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, [
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture\\{BBB}',
        '    FriendlyName    REG_SZ    Microphone (USB Mic)',
      ].join('\r\n')))

    const handler = electronMock.ipcMain.__getHandler('windows:list-audio-devices')
    const devices = await handler()

    expect(devices).toEqual([
      { name: 'Speakers (USB DAC)', type: 'output', id: '{AAA}' },
      { name: 'Microphone (USB Mic)', type: 'input', id: '{BBB}' },
    ])
  })

  it('windows:list-audio-devices returns empty array on registry error', async () => {
    loadMain()

    _cpMock.execFile
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(new Error('reg failure'), ''))
      .mockImplementationOnce((_cmd, _args, _opts, cb) => cb(new Error('reg failure'), ''))

    const handler = electronMock.ipcMain.__getHandler('windows:list-audio-devices')
    const devices = await handler()

    expect(devices).toEqual([])
  })
})

// ── Phase 2: elevated plugin install / remove (no PowerShell) ────────────────

describe('obs plugin elevation — Phase 2', () => {
  // Create the dev-build DLL stub at the path main.js looks for in non-packaged mode
  // so the handler can proceed past the "Plugin DLL not found" guard.
  const devDllDir = path.resolve(
    path.dirname(req.resolve('../../electron/main.js')),
    '..', '..', 'obs-plugin', 'build', 'Release'
  )
  const devDll = path.join(devDllDir, 'openclip-obs.dll')

  function withDevDll(fn) {
    const existed = fs.existsSync(devDll)
    if (!existed) {
      fs.mkdirSync(devDllDir, { recursive: true })
      fs.writeFileSync(devDll, '')
    }
    try { return fn() } finally {
      if (!existed) try { fs.rmSync(devDll, { force: true }) } catch {}
    }
  }

  it('registers obs plugin IPC handlers', () => {
    loadMain()
    expect(typeof electronMock.ipcMain.__getHandler('obs:install-plugin')).toBe('function')
    expect(typeof electronMock.ipcMain.__getHandler('obs:remove-plugin')).toBe('function')
  })

  it('obs:install-plugin returns error when obsInstallPath is missing', async () => {
    loadMain()
    const handler = electronMock.ipcMain.__getHandler('obs:install-plugin')
    const result  = await handler({}, '')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/OBS install folder/i)
  })

  it('obs:install-plugin returns error when obsInstallPath is relative', async () => {
    loadMain()
    const handler = electronMock.ipcMain.__getHandler('obs:install-plugin')
    const result  = await handler({}, 'relative/path')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/OBS install folder/i)
  })

  it('obs:install-plugin calls runElevatedOp when direct copy fails with EPERM', async () => {
    return withDevDll(async () => {
      const runElevatedOpMock = vi.fn().mockReturnValue({ success: true })
      loadMain({ elevatedRunnerMock: { runElevatedOp: runElevatedOpMock } })

      const obsInstallPath = path.join(os.tmpdir(), `obs-install-eperm-${Date.now()}`)
      const origMkdir = fs.mkdirSync
      fs.mkdirSync = vi.fn().mockImplementation((p, opts) => {
        if (String(p).includes('obs-plugins')) {
          const e = new Error('EPERM'); e.code = 'EPERM'; throw e
        }
        return origMkdir(p, opts)
      })

      const handler = electronMock.ipcMain.__getHandler('obs:install-plugin')
      const result  = await handler({}, obsInstallPath)

      fs.mkdirSync = origMkdir

      expect(runElevatedOpMock).toHaveBeenCalledWith(
        expect.objectContaining({ op: 'install-plugin' })
      )
      expect(result).toEqual(expect.objectContaining({ success: true }))
    })
  })

  it('obs:install-plugin forwards elevation failure message to caller', async () => {
    return withDevDll(async () => {
      const runElevatedOpMock = vi.fn().mockReturnValue({
        success: false,
        message: 'UAC was cancelled or the elevated process could not start.',
      })
      loadMain({ elevatedRunnerMock: { runElevatedOp: runElevatedOpMock } })

      const origMkdir = fs.mkdirSync
      fs.mkdirSync = vi.fn().mockImplementation((p, opts) => {
        if (String(p).includes('obs-plugins')) {
          const e = new Error('EPERM'); e.code = 'EPERM'; throw e
        }
        return origMkdir(p, opts)
      })

      const handler = electronMock.ipcMain.__getHandler('obs:install-plugin')
      const result  = await handler({}, path.join(os.tmpdir(), `obs-install-fail-${Date.now()}`))

      fs.mkdirSync = origMkdir

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/UAC|cancelled/i)
    })
  })

  it('obs:remove-plugin calls runElevatedOp when direct remove fails with EACCES', async () => {
    const runElevatedOpMock = vi.fn().mockReturnValue({ success: true })
    loadMain({ elevatedRunnerMock: { runElevatedOp: runElevatedOpMock } })

    // Write a stub DLL at the system plugin dir that obsInstallPath points to
    const fakeInstall  = path.join(os.tmpdir(), `obs-remove-${Date.now()}`)
    const fakePluginDir = path.join(fakeInstall, 'obs-plugins', '64bit')
    fs.mkdirSync(fakePluginDir, { recursive: true })
    const fakePluginDll = path.join(fakePluginDir, 'openclip-obs.dll')
    fs.writeFileSync(fakePluginDll, '')

    // Configure the store to use our fake install path
    // The store's _electron() returns obsInstallPath; patch it for this test
    const storeModule = req(mainPath) // main is already loaded; get the store indirectly
    // We'll patch fs.rmSync so that when the handler tries to delete the DLL it throws EACCES
    const origRm = fs.rmSync
    fs.rmSync = vi.fn().mockImplementation((p, opts) => {
      if (String(p).endsWith('openclip-obs.dll')) {
        const e = new Error('EACCES'); e.code = 'EACCES'; throw e
      }
      return origRm(p, opts)
    })

    // Temporarily set the obsInstallPath in electron config
    const configPath = path.join(os.tmpdir(), 'openclip-test', 'userData', 'electron.json')
    const prevConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify({ obsInstallPath: fakeInstall }))

    // Reload main so the store picks up our config
    loadMain({ elevatedRunnerMock: { runElevatedOp: runElevatedOpMock } })
    const handler = electronMock.ipcMain.__getHandler('obs:remove-plugin')
    await handler({})

    fs.rmSync = origRm
    if (prevConfig !== null) fs.writeFileSync(configPath, prevConfig)
    else try { fs.rmSync(configPath, { force: true }) } catch {}
    try { fs.rmSync(fakeInstall, { recursive: true, force: true }) } catch {}

    expect(runElevatedOpMock).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'remove-plugin' })
    )
  })
})

// ── Phase 2: elevatedHelper unit tests ───────────────────────────────────────

describe('elevatedHelper', () => {
  const helperMod = req('../../electron/elevatedHelper.js')

  it('install-plugin: creates dirs and copies file, writes success result', () => {
    const base       = path.join(os.tmpdir(), 'oc-helper-test-install')
    const dllSrc     = path.join(base, 'src', 'openclip-obs.dll')
    const sysPlugin  = path.join(base, 'dst', 'obs-plugins', '64bit')
    const sysDest    = path.join(sysPlugin, 'openclip-obs.dll')
    const sysLocale  = path.join(base, 'dst', 'data', 'obs-plugins', 'openclip-obs', 'locale')
    const sysLocaleF = path.join(sysLocale, 'en-US.ini')
    const opFile     = path.join(os.tmpdir(), `oc-op-test-${Date.now()}.json`)
    const resultFile = path.join(os.tmpdir(), `oc-result-test-${Date.now()}.json`)

    fs.mkdirSync(path.dirname(dllSrc), { recursive: true })
    fs.writeFileSync(dllSrc, 'dll-binary')
    fs.writeFileSync(opFile, JSON.stringify({ op: 'install-plugin', dllSrc, sysDest, sysPluginDir: sysPlugin, sysLocaleDir: sysLocale, sysLocale: sysLocaleF }))

    helperMod.runHelperOp(opFile, resultFile)

    expect(fs.existsSync(sysDest)).toBe(true)
    expect(fs.existsSync(sysLocaleF)).toBe(true)
    expect(JSON.parse(fs.readFileSync(resultFile, 'utf-8'))).toEqual({ success: true })

    fs.rmSync(base, { recursive: true, force: true })
    try { fs.rmSync(resultFile, { force: true }); } catch {}
  })

  it('remove-plugin: removes DLL and locale dir, writes success result', () => {
    const base       = path.join(os.tmpdir(), 'oc-helper-test-remove')
    const sysDest    = path.join(base, 'openclip-obs.dll')
    const sysLocale  = path.join(base, 'locale')
    const opFile     = path.join(os.tmpdir(), `oc-op-rm-test-${Date.now()}.json`)
    const resultFile = path.join(os.tmpdir(), `oc-result-rm-test-${Date.now()}.json`)

    fs.mkdirSync(sysLocale, { recursive: true })
    fs.writeFileSync(sysDest, 'dll')
    fs.writeFileSync(path.join(sysLocale, 'en-US.ini'), '')
    fs.writeFileSync(opFile, JSON.stringify({ op: 'remove-plugin', sysDest, sysLocale }))

    helperMod.runHelperOp(opFile, resultFile)

    expect(fs.existsSync(sysDest)).toBe(false)
    expect(fs.existsSync(sysLocale)).toBe(false)
    expect(JSON.parse(fs.readFileSync(resultFile, 'utf-8'))).toEqual({ success: true })

    try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(resultFile, { force: true }); } catch {}
  })

  it('writes failure result for unknown op', () => {
    const opFile     = path.join(os.tmpdir(), `oc-op-unk-${Date.now()}.json`)
    const resultFile = path.join(os.tmpdir(), `oc-result-unk-${Date.now()}.json`)

    fs.writeFileSync(opFile, JSON.stringify({ op: 'delete-everything' }))
    helperMod.runHelperOp(opFile, resultFile)

    const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'))
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/unknown/i)

    try { fs.rmSync(resultFile, { force: true }); } catch {}
  })

  it('rejects non-absolute paths in install-plugin', () => {
    const opFile     = path.join(os.tmpdir(), `oc-op-abs-${Date.now()}.json`)
    const resultFile = path.join(os.tmpdir(), `oc-result-abs-${Date.now()}.json`)

    fs.writeFileSync(opFile, JSON.stringify({
      op: 'install-plugin',
      dllSrc:     'relative/path.dll',
      sysDest:    'relative/dest.dll',
      sysPluginDir: 'relative/plugin',
      sysLocaleDir: 'relative/locale',
      sysLocale:  'relative/locale/en-US.ini',
    }))
    helperMod.runHelperOp(opFile, resultFile)

    const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'))
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/absolute/i)

    try { fs.rmSync(resultFile, { force: true }); } catch {}
  })

  it('handles missing op file gracefully', () => {
    const resultFile = path.join(os.tmpdir(), `oc-result-miss-${Date.now()}.json`)
    helperMod.runHelperOp('/nonexistent/path/op.json', resultFile)

    const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'))
    expect(result.success).toBe(false)

    try { fs.rmSync(resultFile, { force: true }); } catch {}
  })
})

// ── Phase 3: hardening tests ──────────────────────────────────────────────────

describe('Phase 3 hardening', () => {
  beforeEach(() => {
    _cpMock.exec.mockReset()
    _cpMock.execFile.mockReset()
    _cpMock.execSync.mockReset()
    _cpMock.execFileSync.mockReset()
    _cpMock.spawn.mockReset()
  })

  // DLL stub helper (same pattern as Phase 2 tests)
  const devDllDir = path.resolve(
    path.dirname(req.resolve('../../electron/main.js')),
    '..', '..', 'obs-plugin', 'build', 'Release'
  )
  const devDll = path.join(devDllDir, 'openclip-obs.dll')

  function withDevDll(fn) {
    const existed = fs.existsSync(devDll)
    if (!existed) {
      fs.mkdirSync(devDllDir, { recursive: true })
      fs.writeFileSync(devDll, '')
    }
    try { return fn() } finally {
      if (!existed) try { fs.rmSync(devDll, { force: true }) } catch {}
    }
  }

  it('windows:list inflight is cleared after a koffi error (cache not poisoned)', async () => {
    // Load main with a detector whose getVisibleWindowsDetailed throws on first call
    let callCount = 0
    loadMain({
      detectorMock: {
        getVisibleWindowsDetailed: () => {
          callCount++
          if (callCount === 1) throw new Error('koffi crash')
          return []
        },
        getRunningProcessesDetailed: () => [],
        findProcessPathByName: () => '',
      },
    })

    const handler = electronMock.ipcMain.__getHandler('windows:list')

    // First call: koffi throws — should return [] and NOT poison the inflight
    const first = await handler()
    expect(Array.isArray(first)).toBe(true)

    // Second call: inflight must have been cleared so this is a fresh call
    // (if inflight was poisoned the promise would be the same rejected one)
    const second = await handler()
    expect(Array.isArray(second)).toBe(true)
  })

  it('elevatedHelper install-plugin success result has no errorKind field', () => {
    const helperMod = req('../../electron/elevatedHelper.js')

    const base       = path.join(os.tmpdir(), 'oc-phase3-helper-test')
    const dllSrc     = path.join(base, 'src', 'openclip-obs.dll')
    const sysPlugin  = path.join(base, 'dst', 'obs-plugins', '64bit')
    const sysDest    = path.join(sysPlugin, 'openclip-obs.dll')
    const sysLocale  = path.join(base, 'dst', 'data', 'obs-plugins', 'openclip-obs', 'locale')
    const sysLocaleF = path.join(sysLocale, 'en-US.ini')
    const opFile     = path.join(os.tmpdir(), `oc-phase3-op-${Date.now()}.json`)
    const resultFile = path.join(os.tmpdir(), `oc-phase3-result-${Date.now()}.json`)

    fs.mkdirSync(path.dirname(dllSrc), { recursive: true })
    fs.writeFileSync(dllSrc, 'dll-binary')
    fs.writeFileSync(opFile, JSON.stringify({
      op: 'install-plugin', dllSrc, sysDest,
      sysPluginDir: sysPlugin, sysLocaleDir: sysLocale, sysLocale: sysLocaleF,
    }))

    helperMod.runHelperOp(opFile, resultFile)

    const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'))
    expect(result.success).toBe(true)
    expect(result.errorKind).toBeUndefined()

    fs.rmSync(base, { recursive: true, force: true })
    try { fs.rmSync(resultFile, { force: true }) } catch {}
  })

  it('runElevatedOp wrapper returns errorKind dependency-missing when elevatedRunner cannot be loaded', async () => {
    return withDevDll(async () => {
      // Inject a broken elevatedRunner that throws on require
      const brokenPath = req.resolve('../../electron/elevatedRunner.js')
      const prev = req.cache[brokenPath]

      // Remove from cache and replace with a module that throws when accessed
      delete req.cache[brokenPath]
      req.cache[brokenPath] = {
        id: brokenPath,
        filename: brokenPath,
        loaded: true,
        get exports() { throw new Error('koffi not available') },
      }

      // Reload main without pre-injecting elevatedRunnerMock so main's
      // runElevatedOp wrapper does the lazy require which hits our broken stub
      loadMain()

      // Trigger the EPERM path so the handler falls through to runElevatedOp
      const origMkdir = fs.mkdirSync
      fs.mkdirSync = vi.fn().mockImplementation((p, opts) => {
        if (String(p).includes('obs-plugins')) {
          const e = new Error('EPERM'); e.code = 'EPERM'; throw e
        }
        return origMkdir(p, opts)
      })

      const handler = electronMock.ipcMain.__getHandler('obs:install-plugin')
      const obsInstallPath = path.join(os.tmpdir(), `obs-p3-dep-${Date.now()}`)
      const result = await handler({}, obsInstallPath)

      fs.mkdirSync = origMkdir

      // Restore original cache entry
      delete req.cache[brokenPath]
      if (prev) req.cache[brokenPath] = prev

      expect(result.success).toBe(false)
      expect(result.errorKind).toBe('dependency-missing')
    })
  })
})
