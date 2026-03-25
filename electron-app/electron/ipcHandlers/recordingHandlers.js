/**
 * IPC handlers for:
 *   - Dialogs (open directory/file)
 *   - Shell operations (show in explorer, open external URL)
 *   - Store get/set
 *   - Window/title-bar chrome
 *   - API port
 *   - Onboarding
 *   - Recording reorganize (week folders) and manual organize
 *   - Auto-updater registration
 */
const { dialog, shell } = require('electron')
const { setWaveformResolution } = require('../waveformPreCache')
const { setupAutoUpdater, setupDevAutoUpdater, registerUpdateHandlers } = require('../autoUpdater')

function registerRecordingHandlers(ipcMain, store, appState) {
  // --- Window chrome ---
  ipcMain.handle('window:setTitleBarOverlay', (_event, options) => {
    const win = appState.mainWindow
    if (!win || win.isDestroyed()) return
    try {
      win.setTitleBarOverlay(options)
    } catch (err) {
      console.warn('[ipc] window:setTitleBarOverlay:', err.message)
    }
  })

  // --- Store ---
  ipcMain.handle('store:get', (_event, key) => store.get(key))
  ipcMain.handle('store:set', (_event, key, value) => {
    const result = store.set(key, value)
    if (key === 'settings' && value?.waveformResolution) {
      setWaveformResolution(value.waveformResolution)
    } else if (key === 'settings.waveformResolution') {
      setWaveformResolution(value)
    }
    return result
  })

  // --- Dialogs ---
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(appState.mainWindow, {
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openFile', async (_event, opts = {}) => {
    const result = await dialog.showOpenDialog(appState.mainWindow, {
      properties: ['openFile'],
      ...opts,
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // --- File / shell operations ---
  ipcMain.handle('shell:showInExplorer', (_event, filePath) => {
    shell.showItemInFolder(filePath)
  })
  ipcMain.handle('shell:openExternal', (_event, url) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    const allowed = ['http:', 'https:', 'mailto:']
    if (!allowed.includes(parsed.protocol)) return false
    return shell.openExternal(url)
  })

  // --- API port ---
  ipcMain.handle('api:port', async () => {
    await appState.apiPortReady
    return appState.apiPort
  })

  // --- Onboarding ---
  ipcMain.handle('onboarding:isComplete', () => {
    return store._electron().onboardingComplete === true
  })
  ipcMain.handle('onboarding:setComplete', (_event, value) => {
    store._electron().onboardingComplete = !!value
    store._saveElectron()
  })

  // --- Reorganize by week-folder setting ---
  ipcMain.handle('recordings:reorganize-week-folders', async (event) => {
    const { reorganizeWeekFolders } = require('../fileManager')
    const onProgress = (label) => {
      try {
        event.sender.send('session:process-progress', { phase: 'recording', label })
      } catch {}
    }
    try {
      const result = await reorganizeWeekFolders(store, onProgress)
      try {
        event.sender.send('session:process-progress', { phase: 'complete' })
      } catch {}
      return result
    } catch (err) {
      try {
        event.sender.send('session:process-progress', { phase: 'error', error: err.message })
      } catch {}
      throw err
    }
  })

  // --- Manual organize ---
  ipcMain.handle('recordings:organize', async (event, { filePath, gameName, remux }) => {
    const { organizeSpecificRecording } = require('../fileManager')
    const moveOnly =
      remux === undefined ? store.get('settings.organizeRemux') === false : remux === false
    const onProgress = (stage, label) => {
      try {
        event.sender.send('recordings:organize-progress', { stage, label })
      } catch {}
    }
    return organizeSpecificRecording(store, filePath, gameName, {
      moveOnly,
      onProgress,
      forceReorganize: true,
    })
  })

  // --- Auto-updater IPC handlers ---
  registerUpdateHandlers(ipcMain, () => appState.mainWindow)
}

module.exports = { registerRecordingHandlers }
