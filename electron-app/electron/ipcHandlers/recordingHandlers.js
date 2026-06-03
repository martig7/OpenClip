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
const fs = require('fs')
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

  // --- Config export ---
  ipcMain.handle('config:export', async () => {
    try {
      const config = {
        _version: 1,
        _app: 'openclip',
        _exported: new Date().toISOString(),
        settings: store.get('settings'),
        games: store.get('games'),
        obsInstallPath: store._electron().obsInstallPath || '',
        fullscreenRecording: store.get('fullscreenRecording'),
        masterAudioSources: store.get('masterAudioSources'),
        audioTracks: store.get('audioTracks'),
        trackNames: store.get('trackNames'),
      }

      const { canceled, filePath } = await dialog.showSaveDialog(appState.mainWindow, {
        title: 'Export OpenClip Config',
        defaultPath: 'openclip-config.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })

      if (canceled || !filePath) return { success: false, canceled: true }

      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
      return { success: true, path: filePath }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // --- Config import ---
  ipcMain.handle('config:import', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(appState.mainWindow, {
        title: 'Import OpenClip Config',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })

      if (canceled || !filePaths?.[0]) return { success: false, canceled: true }

      let config
      try {
        config = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'))
      } catch {
        return { success: false, error: 'File is not valid JSON.' }
      }

      if (config._app !== 'openclip') {
        return { success: false, error: 'File is not an OpenClip config.' }
      }
      if (config._version === undefined || config._version === null) {
        return { success: false, error: 'Config file is missing a version field.' }
      }
      if (!config.settings || typeof config.settings !== 'object') {
        return { success: false, error: 'Config file is missing a settings object.' }
      }

      store.set('settings', config.settings)

      if (config.obsInstallPath !== undefined) {
        store._electron().obsInstallPath = config.obsInstallPath
        store._saveElectron()
      }
      if (config.fullscreenRecording !== undefined) {
        store.set('fullscreenRecording', config.fullscreenRecording)
      }
      if (config.masterAudioSources !== undefined) {
        store.set('masterAudioSources', config.masterAudioSources)
      }
      if (config.audioTracks !== undefined) {
        store.set('audioTracks', config.audioTracks)
      }
      if (config.trackNames !== undefined) {
        store.set('trackNames', config.trackNames)
      }
      if (Array.isArray(config.games)) {
        store.set('games', config.games)
      }

      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerRecordingHandlers }
