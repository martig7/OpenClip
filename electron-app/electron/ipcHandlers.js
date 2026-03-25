/**
 * Registers all IPC handlers for the Electron main process.
 * Call registerIpcHandlers(store, appState) after the store is initialized.
 *
 * appState is a mutable object shared with main.js:
 *   { watcher, watcherStartedAt, currentGame, mainWindow, apiPort, apiPortReady }
 */
const { ipcMain, dialog, shell, globalShortcut, app } = require('electron')
const path = require('path')
const fs = require('fs')

const { setupGameWatcher } = require('./gameWatcher')
const { setupFileManager } = require('./fileManager')
const { readOBSRecordingPath } = require('./obsIntegration')
const {
  getProfiles,
  readEncodingSettings,
  writeEncodingSettings,
  isOBSRunning,
  findOBSExecutable,
} = require('./obsEncoding')
const {
  getOBSScenes,
  createSceneFromTemplate,
  createSceneFromScratch,
  addAudioSourceToScenes,
  removeAudioSourceFromScenes,
  deleteOBSScene,
  getOBSAudioInputs,
  getSceneAudioSources,
  getInputAudioTracks,
  setInputAudioTracks,
  getTrackNames,
  setTrackNames,
  isPluginReachable,
} = require('./obsPlugin')
const { setupAutoUpdater, setupDevAutoUpdater, registerUpdateHandlers } = require('./autoUpdater')
const { RUNTIME_DIR, STATE_FILE, ICONS_DIR, PLUGIN_DLL_NAME } = require('./constants')
const { setWaveformResolution } = require('./waveformPreCache')

// Short-lived caches for native Win32 queries.
const _windowsListCache = { data: null, ts: 0 }
const _audioDevicesCache = { data: null, ts: 0 }
const _runningAppsCache = { data: null, ts: 0 }

// Integration-test mock override for windows:list (null = use real data).
let _testWindowsMock = null

const { runElevated } = require('./runElevated')
const {
  listWindowsWithProcesses,
  listRunningApps,
  listAudioDevices,
  extractProcessIcon,
  findOBSInstallDir,
} = require('./winUtils')

function registerIpcHandlers(store, appState) {
  // appState: { watcher, watcherStartedAt, currentGame, mainWindow, apiPort, apiPortReady }

  function pushWatcherStatus() {
    if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
      const gameState = readGameState()
      appState.mainWindow.webContents.send('watcher:status-push', {
        running: !!appState.watcher,
        currentGame: appState.currentGame,
        startedAt: appState.watcherStartedAt,
        gameState,
      })
    }
  }

  function readGameState() {
    try {
      return fs.readFileSync(STATE_FILE, 'utf-8').trim()
    } catch {
      return null
    }
  }

  function registerHotkey() {
    globalShortcut.unregisterAll()
    const hotkey = store.get('settings.clipMarkerHotkey')
    if (hotkey && appState.currentGame) {
      globalShortcut.register(hotkey, () => {
        const markers = store.get('clipMarkers') || []
        markers.push({
          game: appState.currentGame,
          timestamp: Date.now() / 1000,
          created: new Date().toISOString(),
        })
        store.set('clipMarkers', markers)
        if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
          appState.mainWindow.webContents.send('clip:marker-added', markers.length)
        }
      })
    }
  }

  // Make registerHotkey accessible to main.js via appState
  appState.registerHotkey = registerHotkey

  // --- Window chrome (Windows/Linux title bar overlay; hiddenInset) ---
  ipcMain.handle('window:setTitleBarOverlay', (_event, options) => {
    const win = appState.mainWindow
    if (!win || win.isDestroyed()) return
    try {
      win.setTitleBarOverlay(options)
    } catch (err) {
      console.warn('[ipc] window:setTitleBarOverlay:', err.message)
    }
  })

  // --- Settings ---
  ipcMain.handle('store:get', (_event, key) => store.get(key))
  ipcMain.handle('store:set', (_event, key, value) => {
    const result = store.set(key, value)
    // Update waveform resolution when settings change
    if (key === 'settings' && value?.waveformResolution) {
      setWaveformResolution(value.waveformResolution)
    } else if (key === 'settings.waveformResolution') {
      setWaveformResolution(value)
    }
    return result
  })

  // --- Games ---
  ipcMain.handle('games:list', () => store.get('games'))
  ipcMain.handle('games:add', (_event, game) => {
    const games = store.get('games')
    const id = Date.now().toString(36)
    games.push({ id, ...game, enabled: true })
    store.set('games', games)
    return games
  })
  ipcMain.handle('games:remove', (_event, id) => {
    const games = store.get('games').filter((g) => g.id !== id)
    store.set('games', games)
    return games
  })
  ipcMain.handle('games:toggle', (_event, id) => {
    const games = store.get('games')
    const game = games.find((g) => g.id === id)
    if (game) game.enabled = !game.enabled
    store.set('games', games)
    return games
  })
  ipcMain.handle('games:update', (_event, id, updates) => {
    const games = store.get('games')
    const game = games.find((g) => g.id === id)
    if (game) Object.assign(game, updates)
    store.set('games', games)
    return games
  })

  // --- Fullscreen recording config ---
  ipcMain.handle('fullscreen-recording:get', () => store.get('fullscreenRecording'))
  ipcMain.handle('fullscreen-recording:set', (_event, config) => {
    store.set('fullscreenRecording', config)
  })

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

  // --- Windows ---
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

  // --- File operations ---
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

  // --- Recordings & Clips (delegated to fileManager) ---
  setupFileManager(ipcMain, store)

  // --- Clip marker hotkey ---
  ipcMain.handle('hotkey:register', () => {
    registerHotkey()
    return true
  })

  // --- Watcher ---
  ipcMain.handle('watcher:start', () => {
    if (appState.watcher) return { running: true }
    fs.mkdirSync(RUNTIME_DIR, { recursive: true })
    if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8')

    const { runAutoDelete } = require('./recordingService')
    try {
      runAutoDelete()
    } catch {}

    appState.watcherStartedAt = Date.now()
    appState.watcher = setupGameWatcher(
      store,
      (state) => {
        appState.currentGame = state.currentGame
        pushWatcherStatus()
        registerHotkey()
      },
      (progress) => {
        try {
          appState.mainWindow?.webContents.send('session:process-progress', progress)
        } catch {}
      },
      () => {
        try {
          appState.mainWindow?.webContents.send('games:updated')
        } catch {}
      }
    )
    pushWatcherStatus()
    return { running: true }
  })
  ipcMain.handle('watcher:stop', () => {
    if (appState.watcher) {
      appState.watcher.stop()
      appState.watcher = null
      appState.watcherStartedAt = null
      appState.currentGame = null
      try {
        fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8')
      } catch {}
    }
    pushWatcherStatus()
    return { running: false }
  })
  ipcMain.handle('watcher:status', () => {
    const gameState = readGameState()
    return {
      running: !!appState.watcher,
      currentGame: appState.currentGame,
      startedAt: appState.watcherStartedAt,
      gameState,
    }
  })

  // --- OBS ---
  ipcMain.handle('obs:detect-path', () => readOBSRecordingPath())

  // OBS Encoding
  ipcMain.handle('obs:profiles', () => getProfiles())
  ipcMain.handle('obs:encoding:get', (_e, profileDir) => readEncodingSettings(profileDir))
  ipcMain.handle('obs:encoding:set', (_e, profileDir, settings) => {
    writeEncodingSettings(profileDir, settings)
    return { success: true }
  })
  ipcMain.handle('obs:running', () => isOBSRunning())
  ipcMain.handle('obs:launch', async () => {
    const obsPath = findOBSExecutable()
    if (!obsPath) return { success: false, message: 'OBS executable not found' }
    const error = await shell.openPath(obsPath)
    if (error) return { success: false, message: error }
    return { success: true }
  })

  // OBS Plugin / WebSocket
  ipcMain.handle('obs:ws:script-loaded', async () => {
    try {
      return await isPluginReachable()
    } catch {
      return false
    }
  })
  ipcMain.handle('obs:ws:scenes', async () => {
    try {
      return await getOBSScenes()
    } catch (err) {
      console.error('[main] obs:ws:scenes error:', err.message)
      throw err
    }
  })
  ipcMain.handle('obs:ws:create-scene', (_e, newSceneName, templateSceneName) =>
    createSceneFromTemplate(undefined, newSceneName, templateSceneName)
  )
  ipcMain.handle('obs:ws:create-scene-scratch', (_e, sceneName, options) =>
    createSceneFromScratch(undefined, sceneName, options)
  )
  ipcMain.handle('obs:ws:delete-scene', (_e, sceneName) => deleteOBSScene(undefined, sceneName))
  ipcMain.handle(
    'obs:ws:add-audio-source',
    (_e, sceneNames, inputKind, inputName, inputSettings, options) => {
      return addAudioSourceToScenes(
        undefined,
        sceneNames,
        inputKind,
        inputName,
        inputSettings || {},
        options || {}
      )
    }
  )
  ipcMain.handle('obs:ws:remove-audio-source', (_e, sceneNames, inputName) =>
    removeAudioSourceFromScenes(undefined, sceneNames, inputName)
  )
  ipcMain.handle('obs:ws:get-audio-inputs', async () => {
    try {
      return await getOBSAudioInputs()
    } catch (err) {
      console.error('[main] obs:ws:get-audio-inputs error:', err.message)
      throw err
    }
  })
  ipcMain.handle('obs:ws:get-scene-audio-sources', async (_e, sceneName) => {
    try {
      return await getSceneAudioSources(undefined, sceneName)
    } catch (err) {
      throw err
    }
  })
  ipcMain.handle('obs:ws:get-input-audio-tracks', async (_e, inputName) => {
    try {
      return await getInputAudioTracks(undefined, inputName)
    } catch {
      return {}
    }
  })
  ipcMain.handle('obs:ws:set-input-audio-tracks', async (_e, inputName, tracks) => {
    return setInputAudioTracks(undefined, inputName, tracks)
  })
  ipcMain.handle('obs:ws:get-track-names', () => getTrackNames())
  ipcMain.handle('obs:ws:set-track-names', (_e, names) => setTrackNames(undefined, names))

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

  // --- OBS installation detection ---
  ipcMain.handle('obs:detect-install', () => findOBSInstallDir())

  ipcMain.handle('obs:set-install-path', (_event, installPath) => {
    store._electron().obsInstallPath = installPath || ''
    store._saveElectron()
  })
  ipcMain.handle('obs:get-install-path', () => {
    return store._electron().obsInstallPath || ''
  })

  // --- OBS plugin install/remove ---
  ipcMain.handle('obs:install-plugin', async (_event, obsInstallPath) => {
    try {
      if (!obsInstallPath || !path.isAbsolute(obsInstallPath)) {
        return {
          success: false,
          message: 'OBS install folder is required. Set it in Settings before installing.',
        }
      }

      if (await isOBSRunning()) {
        return {
          success: false,
          message: 'OBS is currently open. Please close OBS before installing the plugin.',
        }
      }

      let dllSrc
      if (app.isPackaged) {
        dllSrc = path.join(process.resourcesPath, 'obs-plugin', PLUGIN_DLL_NAME)
      } else {
        const devBuild = path.join(
          __dirname,
          '..',
          '..',
          'obs-plugin',
          'build',
          'Release',
          PLUGIN_DLL_NAME
        )
        const resBuild = path.join(__dirname, '..', 'resources', 'obs-plugin', PLUGIN_DLL_NAME)
        if (fs.existsSync(devBuild)) dllSrc = devBuild
        else if (fs.existsSync(resBuild)) dllSrc = resBuild
        else
          return {
            success: false,
            message: 'Plugin DLL not found (build it first or place in resources/obs-plugin/)',
          }
      }

      if (!fs.existsSync(dllSrc)) {
        return { success: false, message: `Plugin DLL not found at ${dllSrc}` }
      }

      const sysPluginDir = path.join(obsInstallPath, 'obs-plugins', '64bit')
      const sysDest = path.join(sysPluginDir, PLUGIN_DLL_NAME)
      const sysLocaleDir = path.join(
        obsInstallPath,
        'data',
        'obs-plugins',
        'openclip-obs',
        'locale'
      )
      const sysLocale = path.join(sysLocaleDir, 'en-US.ini')

      let needsElevation = false
      try {
        fs.mkdirSync(sysPluginDir, { recursive: true })
        fs.copyFileSync(dllSrc, sysDest)
        fs.mkdirSync(sysLocaleDir, { recursive: true })
        if (!fs.existsSync(sysLocale)) fs.writeFileSync(sysLocale, '')
        console.log(`[main] Plugin installed (system) to ${sysDest}`)
      } catch (fsErr) {
        if (fsErr.code === 'EPERM' || fsErr.code === 'EACCES' || fsErr.code === 'EBUSY') {
          needsElevation = true
        } else {
          throw fsErr
        }
      }

      if (needsElevation) {
        const elevResult = await runElevated([
          { type: 'mkdir', path: sysPluginDir },
          { type: 'copy', src: dllSrc, dest: sysDest },
          { type: 'mkdir', path: sysLocaleDir },
          { type: 'write', path: sysLocale, content: '' },
        ])
        if (!elevResult.success) return elevResult
        console.log(`[main] Plugin installed (system, elevated) to ${sysDest}`)
      }

      const userBase = path.join(app.getPath('appData'), 'obs-studio', 'plugins', 'openclip-obs')
      const userPluginDir = path.join(userBase, 'obs-plugins', '64bit')
      const userDest = path.join(userPluginDir, PLUGIN_DLL_NAME)
      const userLocaleDir = path.join(userBase, 'data', 'obs-plugins', 'openclip-obs', 'locale')
      const userLocale = path.join(userLocaleDir, 'en-US.ini')

      try {
        fs.mkdirSync(userPluginDir, { recursive: true })
        fs.copyFileSync(dllSrc, userDest)
        fs.mkdirSync(userLocaleDir, { recursive: true })
        if (!fs.existsSync(userLocale)) fs.writeFileSync(userLocale, '')
        console.log(`[main] Plugin installed (user) to ${userDest}`)
      } catch (userErr) {
        console.warn('[main] Could not install to AppData path:', userErr.message)
      }

      try {
        const modulesJson = path.join(
          app.getPath('appData'),
          'obs-studio',
          'plugin_manager',
          'modules.json'
        )
        let modules = []
        if (fs.existsSync(modulesJson)) {
          try {
            modules = JSON.parse(fs.readFileSync(modulesJson, 'utf-8'))
          } catch {}
        }
        const existing = modules.find((m) => m.module_name === 'openclip-obs')
        if (existing) {
          existing.enabled = true
          if (!existing.display_name) existing.display_name = 'OpenClip'
          if (!('id' in existing)) existing.id = ''
          if (!('version' in existing)) existing.version = ''
        } else {
          modules.push({
            display_name: 'OpenClip',
            enabled: true,
            encoders: [],
            id: '',
            module_name: 'openclip-obs',
            outputs: [],
            services: [],
            sources: [],
            version: '',
          })
        }
        fs.mkdirSync(path.dirname(modulesJson), { recursive: true })
        fs.writeFileSync(modulesJson, JSON.stringify(modules, null, 4))
        console.log('[main] modules.json updated — openclip-obs enabled')
      } catch (jsonErr) {
        console.warn('[main] Could not patch modules.json:', jsonErr.message)
      }

      return { success: true, path: sysDest }
    } catch (err) {
      console.error('[main] Plugin install error:', err.message)
      return { success: false, message: err.message }
    }
  })

  ipcMain.handle('obs:is-plugin-registered', () => {
    try {
      const obsInstallPath = store._electron().obsInstallPath || ''
      if (obsInstallPath) {
        if (fs.existsSync(path.join(obsInstallPath, 'obs-plugins', '64bit', PLUGIN_DLL_NAME)))
          return true
      }
      if (
        fs.existsSync(
          path.join(
            app.getPath('appData'),
            'obs-studio',
            'plugins',
            'openclip-obs',
            'obs-plugins',
            '64bit',
            PLUGIN_DLL_NAME
          )
        )
      )
        return true
      return false
    } catch {
      return false
    }
  })

  ipcMain.handle('obs:remove-plugin', async () => {
    try {
      if (await isOBSRunning()) {
        return {
          success: false,
          message: 'OBS is currently open. Please close OBS before removing the plugin.',
        }
      }

      const obsInstallPath = store._electron().obsInstallPath || ''
      if (obsInstallPath) {
        const sysDest = path.join(obsInstallPath, 'obs-plugins', '64bit', PLUGIN_DLL_NAME)
        const sysLocale = path.join(obsInstallPath, 'data', 'obs-plugins', 'openclip-obs')
        if (fs.existsSync(sysDest)) {
          let needsElevation = false
          try {
            fs.rmSync(sysDest, { force: true })
            if (fs.existsSync(sysLocale)) fs.rmSync(sysLocale, { recursive: true, force: true })
            console.log(`[main] Removed system plugin: ${sysDest}`)
          } catch (fsErr) {
            if (fsErr.code === 'EPERM' || fsErr.code === 'EACCES' || fsErr.code === 'EBUSY')
              needsElevation = true
          }
          if (needsElevation) {
            const removeResult = await runElevated([
              { type: 'delete', path: sysDest },
              { type: 'delete', path: sysLocale, recursive: true },
            ])
            if (!removeResult.success) {
              console.error('[main] Elevated removal failed:', removeResult.message)
              return { success: false, message: removeResult.message || 'Elevated removal failed' }
            }
          }
        }
      }

      const userBase = path.join(app.getPath('appData'), 'obs-studio', 'plugins', 'openclip-obs')
      if (fs.existsSync(userBase)) {
        fs.rmSync(userBase, { recursive: true, force: true })
        console.log(`[main] Removed user plugin folder: ${userBase}`)
      }

      try {
        const modulesJson = path.join(
          app.getPath('appData'),
          'obs-studio',
          'plugin_manager',
          'modules.json'
        )
        if (fs.existsSync(modulesJson)) {
          let modules = JSON.parse(fs.readFileSync(modulesJson, 'utf-8'))
          const filtered = modules.filter((m) => m.module_name !== 'openclip-obs')
          if (filtered.length !== modules.length) {
            fs.writeFileSync(modulesJson, JSON.stringify(filtered, null, 4))
            console.log('[main] Removed openclip-obs from modules.json')
          }
        }
      } catch (jsonErr) {
        console.warn('[main] Could not update modules.json on remove:', jsonErr.message)
      }

      return { success: true }
    } catch (err) {
      return { success: false, message: err.message }
    }
  })

  // --- Manual organize ---
  ipcMain.handle('recordings:organize', async (event, { filePath, gameName, remux }) => {
    const { organizeSpecificRecording } = require('./fileManager')
    const moveOnly =
      remux === undefined ? store.get('settings.organizeRemux') === false : remux === false
    const onProgress = (stage, label) => {
      try {
        event.sender.send('recordings:organize-progress', { stage, label })
      } catch {}
    }
    return organizeSpecificRecording(store, filePath, gameName, { moveOnly, onProgress, forceReorganize: true })
  })

  // --- Auto-updater IPC handlers ---
  registerUpdateHandlers(ipcMain, () => appState.mainWindow)
}

module.exports = { registerIpcHandlers }
