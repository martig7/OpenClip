// OpenClip OBS Plugin — Electron-side HTTP client (native plugin HTTP API on localhost).

const { resolvePluginPort, callPluginHttp } = require('./pluginHttpTransport')

let DEFAULT_PLUGIN_PORT_FILE = null
try {
  // In Electron runtime this resolves to %APPDATA%/.../runtime/plugin_port.
  // In pure Node test runners (no Electron app object), constants.js can fail.
  // In that case tests should provide OPENCLIP_PLUGIN_HTTP_PORT or
  // OPENCLIP_PLUGIN_PORT_FILE.
  DEFAULT_PLUGIN_PORT_FILE = require('./constants').PLUGIN_PORT_FILE
} catch {
  DEFAULT_PLUGIN_PORT_FILE = null
}

/**
 * Call the plugin's JSON API.
 * @param {string} method - API method name
 * @param {object} params - Parameters object (optional)
 * @returns {Promise<any>} - The `data` field from a successful response
 */
async function callPlugin(method, params = {}) {
  const port = resolvePluginPort(DEFAULT_PLUGIN_PORT_FILE)
  if (!port) {
    throw new Error('OpenClip OBS plugin is not running. Start OBS with the plugin installed.')
  }
  return callPluginHttp(port, method, params)
}

/* ── Public API (scene/audio helpers + recording control) ───────────────────── */

/**
 * Test connection to the OBS plugin.  Returns { success, version } or
 * { success: false, message }.  The wsSettings parameter is accepted for
 * backward compatibility but ignored — the plugin runs on localhost.
 */
async function testOBSConnection(_wsSettings) {
  try {
    const data = await callPlugin('getStatus')
    return {
      success: true,
      version: `OBS ${data.obsVersion} (plugin v${data.pluginVersion})`,
    }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

async function getOBSScenes(_wsSettings) {
  return await callPlugin('getScenes')
}

async function createSceneFromTemplate(_wsSettings, newSceneName, templateSceneName) {
  try {
    const data = await callPlugin('createSceneFromTemplate', {
      sceneName: newSceneName,
      templateSceneName,
    })
    return { success: true, message: data.message || `Scene "${newSceneName}" created` }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

async function createSceneFromScratch(_wsSettings, sceneName, options = {}) {
  try {
    const data = await callPlugin('createSceneFromScratch', {
      sceneName,
      ...options,
    })
    const added = data.addedSources || []
    const errors = data.errors || []
    let message = `Scene "${sceneName}" created`
    if (added.length > 0) message += ` with ${added.join(', ')}`
    if (errors.length > 0) message += `. Some sources could not be added: ${errors.join('; ')}`
    return { success: true, message }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

async function deleteOBSScene(_wsSettings, sceneName) {
  try {
    await callPlugin('deleteScene', { sceneName })
    return { success: true, message: `Scene "${sceneName}" deleted from OBS` }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

async function addAudioSourceToScenes(
  _wsSettings,
  sceneNames,
  inputKind,
  inputName,
  inputSettings = {},
  options = {}
) {
  if (!sceneNames || sceneNames.length === 0) {
    return { success: false, message: 'No scene names provided', results: [] }
  }
  if (!inputKind || !inputName) {
    return { success: false, message: 'Input kind and name are required', results: [] }
  }

  const results = []
  let addedCount = 0
  let skippedCount = 0

  for (const sceneName of sceneNames) {
    try {
      // Check if already present
      const items = await callPlugin('getSceneItems', { sceneName })
      const alreadyIn = (items || []).some((item) => item.sourceName === inputName)

      if (alreadyIn) {
        results.push({ scene: sceneName, status: 'already present' })
        skippedCount++
        continue
      }

      await callPlugin('addSource', {
        sceneName,
        inputName,
        inputKind,
        inputSettings,
        fitToCanvas: !!options.fitToCanvas,
      })
      results.push({ scene: sceneName, status: 'added' })
      addedCount++
    } catch (err) {
      results.push({ scene: sceneName, status: 'error', error: err.message })
    }
  }

  let message =
    addedCount > 0
      ? `"${inputName}" added to ${addedCount} scene(s)`
      : `"${inputName}" was already in all scenes`
  if (skippedCount > 0) message += ` (skipped ${skippedCount} that already had it)`
  const errors = results.filter((r) => r.status === 'error').length
  if (errors > 0) message += `, ${errors} failed`

  return {
    success: addedCount > 0 || skippedCount > 0,
    message,
    results,
    added: addedCount,
    skipped: skippedCount,
  }
}

async function removeAudioSourceFromScenes(_wsSettings, sceneNames, inputName) {
  if (!sceneNames || sceneNames.length === 0) {
    return { success: false, message: 'No scene names provided', results: [] }
  }
  if (!inputName) {
    return { success: false, message: 'Input name is required', results: [] }
  }

  const results = []
  for (const sceneName of sceneNames) {
    try {
      const items = await callPlugin('getSceneItems', { sceneName })
      const matching = (items || []).filter((item) => item.sourceName === inputName)
      if (matching.length === 0) {
        results.push({ scene: sceneName, status: 'not found' })
        continue
      }
      for (const item of matching) {
        await callPlugin('removeSceneItem', {
          sceneName,
          sceneItemId: item.sceneItemId,
        })
      }
      results.push({ scene: sceneName, status: 'removed' })
    } catch (err) {
      results.push({ scene: sceneName, status: 'error', error: err.message })
    }
  }

  const removed = results.filter((r) => r.status === 'removed').length
  const notFound = results.filter((r) => r.status === 'not found').length
  const errors = results.filter((r) => r.status === 'error').length
  let message = `"${inputName}" removed from ${removed} scene(s)`
  if (notFound > 0) message += `, not found in ${notFound}`
  if (errors > 0) message += `, ${errors} failed`

  const success = results.length > 0 && errors !== results.length
  return { success, message, results }
}

async function getOBSAudioInputs(_wsSettings) {
  return await callPlugin('getAudioInputs')
}

async function getSceneAudioSources(_wsSettings, sceneName) {
  if (!sceneName || !sceneName.trim()) return []
  return await callPlugin('getSceneAudioSources', {
    sceneName: sceneName.trim(),
  })
}

async function getInputAudioTracks(_wsSettings, inputName) {
  if (!inputName) throw new Error('Input name is required')
  return await callPlugin('getInputAudioTracks', { inputName })
}

async function setInputAudioTracks(_wsSettings, inputName, tracks) {
  if (!inputName) return { success: false, message: 'Input name is required' }
  try {
    await callPlugin('setInputAudioTracks', { inputName, tracks })
    return { success: true, message: `Track routing updated for "${inputName}"` }
  } catch (err) {
    return { success: false, message: err.message }
  }
}

async function getTrackNames(_wsSettings) {
  try {
    return await callPlugin('getTrackNames')
  } catch {
    return ['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6']
  }
}

async function setTrackNames(_wsSettings, names) {
  try {
    await callPlugin('setTrackNames', { names })
    return { success: true }
  } catch (err) {
    throw err
  }
}

/* ── Plugin-only methods (recording control, used by gameWatcher) ─────────── */

async function startRecording(sceneName) {
  return await callPlugin('startRecording', { sceneName: sceneName || '' })
}

async function stopRecording() {
  return await callPlugin('stopRecording')
}

async function getRecordingStatus() {
  return await callPlugin('getRecordingStatus')
}

async function isPluginReachable() {
  try {
    await callPlugin('getStatus')
    return true
  } catch {
    return false
  }
}

module.exports = {
  getOBSScenes,
  createSceneFromTemplate,
  createSceneFromScratch,
  deleteOBSScene,
  addAudioSourceToScenes,
  removeAudioSourceFromScenes,
  testOBSConnection,
  getOBSAudioInputs,
  getSceneAudioSources,
  getInputAudioTracks,
  setInputAudioTracks,
  getTrackNames,
  setTrackNames,

  // New plugin-specific methods
  startRecording,
  stopRecording,
  getRecordingStatus,
  isPluginReachable,
  callPlugin,
}
