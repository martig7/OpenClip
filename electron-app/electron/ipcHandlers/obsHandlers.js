/**
 * IPC handlers for all OBS-related operations:
 *   - OBS path detection and encoding settings
 *   - OBS plugin install/remove/query
 *   - OBS WebSocket (scenes, audio sources, tracks)
 *   - OBS installation path management
 */
const fs = require('fs')
const path = require('path')
const { app, shell } = require('electron')
const { readOBSRecordingPath } = require('../obsIntegration')
const {
  getProfiles,
  readEncodingSettings,
  writeEncodingSettings,
  isOBSRunning,
  findOBSExecutable,
} = require('../obsEncoding')
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
  getTrackNamesLive,
  setTrackNames,
  isPluginReachable,
} = require('../obsPlugin')
const { runElevated } = require('../runElevated')
const { findOBSInstallDir } = require('../winUtils')
const { PLUGIN_DLL_NAME } = require('../constants')

function registerObsHandlers(ipcMain, store, _appState) {
  // --- OBS path / encoding ---
  ipcMain.handle('obs:detect-path', () => readOBSRecordingPath())
  ipcMain.handle('obs:profiles', () => getProfiles())
  ipcMain.handle('obs:encoding:get', (_e, profileDir) => readEncodingSettings(profileDir))
  ipcMain.handle('obs:encoding:set', (_e, profileDir, settings) => {
    try {
      writeEncodingSettings(profileDir, settings)
      return { success: true }
    } catch (err) {
      console.error('[obsHandlers] obs:encoding:set error:', err.message)
      return { success: false, error: err.message }
    }
  })
  ipcMain.handle('obs:running', () => isOBSRunning())
  ipcMain.handle('obs:launch', async () => {
    const obsPath = findOBSExecutable()
    if (!obsPath) return { success: false, message: 'OBS executable not found' }
    const error = await shell.openPath(obsPath)
    if (error) return { success: false, message: error }
    return { success: true }
  })

  // --- OBS Plugin / WebSocket ---
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
  ipcMain.handle('obs:ws:get-track-names-live', () => getTrackNamesLive())
  ipcMain.handle('obs:ws:set-track-names', (_e, names) => setTrackNames(undefined, names))

  // --- OBS installation detection ---
  ipcMain.handle('obs:detect-install', () => findOBSInstallDir())
  ipcMain.handle('obs:set-install-path', (_event, installPath) => {
    store._electron().obsInstallPath = installPath || ''
    store._saveElectron()
  })
  ipcMain.handle('obs:get-install-path', () => {
    return store._electron().obsInstallPath || ''
  })

  // --- OBS plugin install ---
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
          '..',
          'obs-plugin',
          'build',
          'Release',
          PLUGIN_DLL_NAME
        )
        const resBuild = path.join(__dirname, '..', '..', 'resources', 'obs-plugin', PLUGIN_DLL_NAME)
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
          } catch (parseErr) {
            console.error(
              `[obsHandlers] Failed to parse modules.json at ${modulesJson}:`,
              parseErr.message
            )
            // Preserve the corrupt file as a backup before overwriting
            try {
              fs.copyFileSync(modulesJson, `${modulesJson}.corrupt`)
            } catch {}
            // modules stays [] so we cleanly re-add our entry
          }
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

  // --- OBS plugin query ---
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

  // --- OBS plugin remove ---
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
            if (fsErr.code === 'EPERM' || fsErr.code === 'EACCES' || fsErr.code === 'EBUSY') {
              needsElevation = true
            } else {
              // Unexpected error — surface it so the caller doesn't see false success
              console.error('[obsHandlers] obs:remove-plugin unexpected fs error:', fsErr.message)
              throw fsErr
            }
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
          let modules
          try {
            modules = JSON.parse(fs.readFileSync(modulesJson, 'utf-8'))
          } catch (parseErr) {
            console.warn(
              `[obsHandlers] Could not parse modules.json at ${modulesJson} during removal:`,
              parseErr.message
            )
            modules = []
          }
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
}

module.exports = { registerObsHandlers }
