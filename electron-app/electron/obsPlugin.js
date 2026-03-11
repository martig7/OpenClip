// OpenClip OBS Plugin — Electron-side HTTP client
//
// Communicates with the native OBS plugin's HTTP API on localhost.
// Drop-in replacement for the previous obsWebSocket.js module — exports the
// same public API but talks to the plugin instead of obs-websocket-js.

const http = require('http');
const fs = require('fs');
const { PLUGIN_PORT_FILE } = require('./constants');

/* ── Port discovery ───────────────────────────────────────────────────────── */

let cachedPort = null;
let portReadTime = 0;
const PORT_CACHE_MS = 3000;

function readPluginPort() {
  const now = Date.now();
  if (cachedPort && now - portReadTime < PORT_CACHE_MS) return cachedPort;
  try {
    const raw = fs.readFileSync(PLUGIN_PORT_FILE, 'utf-8').trim();
    const port = parseInt(raw, 10);
    if (port > 0 && port < 65536) {
      cachedPort = port;
      portReadTime = now;
      return port;
    }
  } catch {}
  cachedPort = null;
  return null;
}

function invalidatePortCache() {
  cachedPort = null;
  portReadTime = 0;
}

/* ── HTTP transport ───────────────────────────────────────────────────────── */

const REQUEST_TIMEOUT_MS = 10000;

function parsePluginError(err) {
  const msg = err.message || '';
  if (msg.includes('ECONNREFUSED') || msg.includes('refused')) {
    return 'Cannot connect to OpenClip OBS plugin. Make sure OBS is running with the plugin installed.';
  }
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'Plugin request timed out. OBS may be busy or unresponsive.';
  }
  if (msg.includes('ECONNRESET') || msg.includes('socket hang up')) {
    return 'Connection to OBS plugin was reset. OBS may have closed.';
  }
  return msg || 'Failed to communicate with OBS plugin';
}

/**
 * Call the plugin's JSON API.
 * @param {string} method - API method name
 * @param {object} params - Parameters object (optional)
 * @returns {Promise<any>} - The `data` field from a successful response
 */
async function callPlugin(method, params = {}) {
  const port = readPluginPort();
  if (!port) {
    throw new Error(
      'OpenClip OBS plugin is not running. Start OBS with the plugin installed.'
    );
  }

  const body = JSON.stringify({ method, params });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.success) {
              resolve(json.data);
            } else {
              reject(new Error(json.error || 'Plugin returned an error'));
            }
          } catch {
            reject(new Error('Invalid response from OBS plugin'));
          }
        });
      }
    );
    req.on('error', (err) => {
      invalidatePortCache();
      reject(new Error(parsePluginError(err)));
    });
    req.on('timeout', () => {
      invalidatePortCache();
      req.destroy();
      reject(new Error('Plugin request timed out'));
    });
    req.write(body);
    req.end();
  });
}

/* ── Public API (matches obsWebSocket.js exports) ─────────────────────────── */

/**
 * Test connection to the OBS plugin.  Returns { success, version } or
 * { success: false, message }.  The wsSettings parameter is accepted for
 * backward compatibility but ignored — the plugin runs on localhost.
 */
async function testOBSConnection(_wsSettings) {
  try {
    const data = await callPlugin('getStatus');
    return {
      success: true,
      version: `OBS ${data.obsVersion} (plugin v${data.pluginVersion})`,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function getOBSScenes(_wsSettings) {
  return await callPlugin('getScenes');
}

async function createSceneFromTemplate(_wsSettings, newSceneName, templateSceneName) {
  try {
    const data = await callPlugin('createSceneFromTemplate', {
      sceneName: newSceneName,
      templateSceneName,
    });
    return { success: true, message: data.message || `Scene "${newSceneName}" created` };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function createSceneFromScratch(_wsSettings, sceneName, options = {}) {
  try {
    const data = await callPlugin('createSceneFromScratch', {
      sceneName,
      ...options,
    });
    const added = data.addedSources || [];
    const errors = data.errors || [];
    let message = `Scene "${sceneName}" created`;
    if (added.length > 0) message += ` with ${added.join(', ')}`;
    if (errors.length > 0) message += `. Some sources could not be added: ${errors.join('; ')}`;
    return { success: true, message };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function deleteOBSScene(_wsSettings, sceneName) {
  try {
    await callPlugin('deleteScene', { sceneName });
    return { success: true, message: `Scene "${sceneName}" deleted from OBS` };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function addAudioSourceToScenes(_wsSettings, sceneNames, inputKind, inputName, inputSettings = {}, options = {}) {
  if (!sceneNames || sceneNames.length === 0) {
    return { success: false, message: 'No scene names provided', results: [] };
  }
  if (!inputKind || !inputName) {
    return { success: false, message: 'Input kind and name are required', results: [] };
  }

  const results = [];
  let addedCount = 0;
  let skippedCount = 0;

  for (const sceneName of sceneNames) {
    try {
      // Check if already present
      const items = await callPlugin('getSceneItems', { sceneName });
      const alreadyIn = (items || []).some(
        (item) => item.sourceName === inputName
      );

      if (alreadyIn) {
        results.push({ scene: sceneName, status: 'already present' });
        skippedCount++;
        continue;
      }

      await callPlugin('addSource', {
        sceneName,
        inputName,
        inputKind,
        inputSettings,
        fitToCanvas: !!options.fitToCanvas,
      });
      results.push({ scene: sceneName, status: 'added' });
      addedCount++;
    } catch (err) {
      results.push({ scene: sceneName, status: 'error', error: err.message });
    }
  }

  let message =
    addedCount > 0
      ? `"${inputName}" added to ${addedCount} scene(s)`
      : `"${inputName}" was already in all scenes`;
  if (skippedCount > 0) message += ` (skipped ${skippedCount} that already had it)`;
  const errors = results.filter((r) => r.status === 'error').length;
  if (errors > 0) message += `, ${errors} failed`;

  return {
    success: addedCount > 0 || skippedCount > 0,
    message,
    results,
    added: addedCount,
    skipped: skippedCount,
  };
}

async function removeAudioSourceFromScenes(_wsSettings, sceneNames, inputName) {
  if (!sceneNames || sceneNames.length === 0) {
    return { success: false, message: 'No scene names provided', results: [] };
  }
  if (!inputName) {
    return { success: false, message: 'Input name is required', results: [] };
  }

  const results = [];
  for (const sceneName of sceneNames) {
    try {
      const items = await callPlugin('getSceneItems', { sceneName });
      const matching = (items || []).filter(
        (item) => item.sourceName === inputName
      );
      if (matching.length === 0) {
        results.push({ scene: sceneName, status: 'not found' });
        continue;
      }
      for (const item of matching) {
        await callPlugin('removeSceneItem', {
          sceneName,
          sceneItemId: item.sceneItemId,
        });
      }
      results.push({ scene: sceneName, status: 'removed' });
    } catch (err) {
      results.push({ scene: sceneName, status: 'error', error: err.message });
    }
  }

  const removed = results.filter((r) => r.status === 'removed').length;
  const notFound = results.filter((r) => r.status === 'not found').length;
  const errors = results.filter((r) => r.status === 'error').length;
  let message = `"${inputName}" removed from ${removed} scene(s)`;
  if (notFound > 0) message += `, not found in ${notFound}`;
  if (errors > 0) message += `, ${errors} failed`;

  const success = results.length > 0 && errors !== results.length;
  return { success, message, results };
}

async function getOBSAudioInputs(_wsSettings) {
  return await callPlugin('getAudioInputs');
}

async function getSceneAudioSources(_wsSettings, sceneName) {
  if (!sceneName || !sceneName.trim()) return [];
  return await callPlugin('getSceneAudioSources', {
    sceneName: sceneName.trim(),
  });
}

async function getInputAudioTracks(_wsSettings, inputName) {
  if (!inputName) throw new Error('Input name is required');
  return await callPlugin('getInputAudioTracks', { inputName });
}

async function setInputAudioTracks(_wsSettings, inputName, tracks) {
  if (!inputName) return { success: false, message: 'Input name is required' };
  try {
    await callPlugin('setInputAudioTracks', { inputName, tracks });
    return { success: true, message: `Track routing updated for "${inputName}"` };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function getTrackNames(_wsSettings) {
  try {
    return await callPlugin('getTrackNames');
  } catch {
    return ['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6'];
  }
}

async function setTrackNames(_wsSettings, names) {
  try {
    await callPlugin('setTrackNames', { names });
    return { success: true };
  } catch (err) {
    throw err;
  }
}

/* ── Plugin-only methods (recording control, used by gameWatcher) ─────────── */

async function startRecording(sceneName) {
  return await callPlugin('startRecording', { sceneName: sceneName || '' });
}

async function stopRecording() {
  return await callPlugin('stopRecording');
}

async function getRecordingStatus() {
  return await callPlugin('getRecordingStatus');
}

async function isPluginReachable() {
  try {
    await callPlugin('getStatus');
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  // Same interface as obsWebSocket.js
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
  invalidatePortCache,
};
