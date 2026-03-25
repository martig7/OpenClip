/**
 * IPC handlers for Win32 window/process/audio-device queries.
 * Short-lived caches are kept module-local to avoid repeated native calls.
 */
const fs = require('fs')
const path = require('path')
const { ICONS_DIR } = require('../constants')
const {
  listWindowsWithProcesses,
  listRunningApps,
  listAudioDevices,
  extractProcessIcon,
} = require('../winUtils')

// Short-lived caches for native Win32 queries.
const _windowsListCache = { data: null, ts: 0 }
const _audioDevicesCache = { data: null, ts: 0 }
const _runningAppsCache = { data: null, ts: 0 }

// Integration-test mock override for windows:list (null = use real data).
let _testWindowsMock = null

function registerWindowHandlers(ipcMain, _store, _appState) {
  // Extract the icon for a running process and save it as a PNG.
  ipcMain.handle('windows:extractIcon', async (_event, processName) => {
    if (!processName || !/^[\w\-. ]+$/.test(processName)) return null
    fs.mkdirSync(ICONS_DIR, { recursive: true })
    const outPath = path.join(ICONS_DIR, `${path.basename(processName)}.png`)
    try {
      return await extractProcessIcon(processName, outPath)
    } catch (err) {
      console.error('[ipcHandlers] windows:extractIcon:', err.message)
      return null
    }
  })

  ipcMain.handle('windows:list', async () => {
    if (_testWindowsMock !== null) return _testWindowsMock
    const now = Date.now()
    if (_windowsListCache.data !== null && now - _windowsListCache.ts < 5000)
      return _windowsListCache.data
    try {
      const result = listWindowsWithProcesses()
      _windowsListCache.data = result
      _windowsListCache.ts = Date.now()
      return result
    } catch (err) {
      console.error('[ipcHandlers] windows:list:', err.message)
      return []
    }
  })

  // Integration-test only: override / clear the windows list mock.
  const isIntegrationMode =
    process.env.OPENCLIP_INTEGRATION_TEST === 'true' ||
    process.argv.includes('--integration-mode')
  if (isIntegrationMode) {
    ipcMain.handle('windows:list:set-mock', (_, data) => {
      _testWindowsMock = data
    })
    ipcMain.handle('windows:list:clear-mock', () => {
      _testWindowsMock = null
    })
  }

  ipcMain.handle('windows:list-audio-devices', async () => {
    const now = Date.now()
    if (_audioDevicesCache.data !== null && now - _audioDevicesCache.ts < 10000)
      return _audioDevicesCache.data
    try {
      const result = listAudioDevices()
      _audioDevicesCache.data = result
      _audioDevicesCache.ts = Date.now()
      return result
    } catch (err) {
      console.error('[ipcHandlers] windows:list-audio-devices:', err.message)
      return []
    }
  })

  ipcMain.handle('windows:list-running-apps', async () => {
    const now = Date.now()
    if (_runningAppsCache.data !== null && now - _runningAppsCache.ts < 5000)
      return _runningAppsCache.data
    try {
      const result = listRunningApps()
      _runningAppsCache.data = result
      _runningAppsCache.ts = Date.now()
      return result
    } catch (err) {
      console.error('[ipcHandlers] windows:list-running-apps:', err.message)
      return []
    }
  })
}

module.exports = { registerWindowHandlers }
