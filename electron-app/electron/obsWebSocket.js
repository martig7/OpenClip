// OBS WebSocket integration using obs-websocket-js (v5 protocol)
// Provides scene listing and scene creation from a template scene.

const DEFAULT_WS_HOST = 'localhost';
const DEFAULT_WS_PORT = 4455;
const CONNECT_TIMEOUT_MS = 5000;

// Cache the ESM import — obs-websocket-js v5 is ESM-only
let _obsWebSocketClass = null;
async function getOBSWebSocket() {
  if (!_obsWebSocketClass) {
    const mod = await import('obs-websocket-js');
    _obsWebSocketClass = mod.default;
  }
  return _obsWebSocketClass;
}

/**
 * Build a ws:// URL from host/port settings.
 * @param {object} wsSettings - { host, port }
 */
function buildWsUrl(wsSettings) {
  const host = (wsSettings && wsSettings.host) || DEFAULT_WS_HOST;
  const port = (wsSettings && wsSettings.port) || DEFAULT_WS_PORT;
  return `ws://${host}:${port}`;
}

/**
 * Parse OBS WebSocket errors into user-friendly messages.
 * @param {Error} err - The error from obs-websocket-js
 * @returns {string} User-friendly error message
 */
function parseOBSError(err) {
  const msg = err.message || '';
  
  // WebSocket error code 1006: abnormal closure (connection refused)
  if (err.code === 1006 || msg.includes('1006')) {
    return 'Cannot connect to OBS. Make sure OBS is running and WebSocket Server is enabled in Tools → WebSocket Server Settings.';
  }
  
  // Authentication errors
  if (msg.includes('authentication') || msg.includes('password')) {
    return 'Authentication failed. Check your WebSocket password in Settings.';
  }
  
  // Connection timeout
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return 'Connection timed out. Verify OBS is running and the host/port are correct.';
  }
  
  // Connection refused
  if (msg.includes('ECONNREFUSED') || msg.includes('refused')) {
    return 'Connection refused. Check that OBS WebSocket Server is enabled and the port is correct.';
  }
  
  // Generic fallback
  return msg || 'Failed to connect to OBS WebSocket';
}

/**
 * Connect to OBS WebSocket, run an async callback with the connected client,
 * then disconnect. Returns the callback's result or throws on error.
 * @param {object} wsSettings - { host, port, password }
 * @param {(obs: any) => Promise<any>} callback
 */
async function withOBSConnection(wsSettings, callback) {
  const OBSWebSocket = await getOBSWebSocket();
  const obs = new OBSWebSocket();

  const url = buildWsUrl(wsSettings);
  const password = (wsSettings && wsSettings.password) || undefined;

  // Race connection against a timeout; clear the timer when connection settles.
  // If the timeout fires first, hook the connect promise so we can disconnect
  // once it eventually resolves — preventing an orphaned background WebSocket.
  const connectPromise = obs.connect(url, password);
  
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connectPromise.then(
          () => { obs.disconnect().catch(() => {}); },
          () => { /* connect failed anyway, nothing to clean up */ }
        );
        reject(new Error('OBS WebSocket connection timed out'));
      }, CONNECT_TIMEOUT_MS);
      connectPromise.then(
        () => { clearTimeout(timer); resolve(); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  } catch (err) {
    // Wrap with user-friendly error message
    const friendlyMessage = parseOBSError(err);
    const wrappedError = new Error(friendlyMessage);
    wrappedError.code = err.code;
    wrappedError.originalError = err;
    throw wrappedError;
  }

  try {
    return await callback(obs);
  } finally {
    try { await obs.disconnect(); } catch {}
  }
}

/**
 * Retrieve the list of scene names from OBS.
 * @param {object} wsSettings - { host, port, password }
 * @returns {Promise<string[]>} Array of scene names
 */
async function getOBSScenes(wsSettings) {
  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      const { scenes } = await obs.call('GetSceneList');
      // scenes are returned newest-first; keep that order
      return scenes.map(s => s.sceneName);
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to get OBS scenes:', err.message);
    throw err;
  }
}

/**
 * Create a new OBS scene that copies all sources from a template scene.
 * If the template scene is not provided or not found, creates an empty scene.
 *
 * Steps:
 *  1. Create the new scene
 *  2. If template provided: get all scene items from the template
 *  3. Duplicate each item into the new scene (preserving position/transform)
 *
 * @param {object} wsSettings - { host, port, password }
 * @param {string} newSceneName - Name for the new scene
 * @param {string|null} templateSceneName - Name of the existing scene to copy from
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function createSceneFromTemplate(wsSettings, newSceneName, templateSceneName) {
  if (!newSceneName || !newSceneName.trim()) {
    return { success: false, message: 'Scene name is required' };
  }
  const trimmedName = newSceneName.trim();

  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      // Check that the scene doesn't already exist
      const { scenes } = await obs.call('GetSceneList');
      const existingNames = scenes.map(s => s.sceneName);
      if (existingNames.includes(trimmedName)) {
        return { success: false, message: `Scene "${trimmedName}" already exists in OBS` };
      }

      // Create the new (empty) scene
      await obs.call('CreateScene', { sceneName: trimmedName });

      // If no template, we're done
      if (!templateSceneName || !templateSceneName.trim()) {
        return { success: true, message: `Scene "${trimmedName}" created successfully` };
      }

      // Attempt to copy sources from the template. If anything unexpected throws
      // after the scene was already created, remove the empty scene so OBS is not
      // left in an inconsistent state.
      try {
        const trimmedTemplate = templateSceneName.trim();
        if (!existingNames.includes(trimmedTemplate)) {
          return {
            success: true,
            message: `Scene "${trimmedName}" created (template "${trimmedTemplate}" not found — created empty)`,
          };
        }

        // Get all scene items from the template
        const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: trimmedTemplate });

        if (!sceneItems || sceneItems.length === 0) {
          return { success: true, message: `Scene "${trimmedName}" created (template was empty)` };
        }

        // Duplicate all items in parallel; non-fatal if individual items fail
        // (e.g. nested scenes may not support DuplicateSceneItem)
        const results = await Promise.allSettled(
          sceneItems.map(item =>
            obs.call('DuplicateSceneItem', {
              sceneName: trimmedTemplate,
              sceneItemId: item.sceneItemId,
              destinationSceneName: trimmedName,
            })
          )
        );
        results.forEach((result, i) => {
          if (result.status === 'rejected') {
            console.warn(`[obsWebSocket] Could not duplicate item "${sceneItems[i].sourceName}": ${result.reason?.message}`);
          }
        });
        const copiedCount = results.filter(r => r.status === 'fulfilled').length;

        return {
          success: true,
          message: `Scene "${trimmedName}" created with ${copiedCount}/${sceneItems.length} sources from "${trimmedTemplate}"`,
        };
      } catch (err) {
        // Clean up the newly created scene so OBS isn't left with an empty shell
        try { await obs.call('RemoveScene', { sceneName: trimmedName }); } catch {}
        throw err;
      }
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to create scene:', err.message);
    return { success: false, message: err.message };
  }
}

/**
 * Create a new OBS scene from scratch with optional window capture and audio sources.
 *
 * Steps:
 *  1. Create the new scene
 *  2. Optionally add a game_capture (or window_capture fallback) source
 *  3. Optionally add desktop audio (wasapi_output_capture) source
 *  4. Optionally add microphone (wasapi_input_capture) source
 *
 * @param {object} wsSettings - { host, port, password }
 * @param {string} sceneName - Name for the new scene
 * @param {object} [options]
 * @param {string}  [options.windowTitle]     - Window title to use for game/window capture
 * @param {boolean} [options.addWindowCapture] - Whether to add a window/game capture source
 * @param {boolean} [options.addDesktopAudio]  - Whether to add a desktop audio source
 * @param {boolean} [options.addMicAudio]      - Whether to add a microphone audio source
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function createSceneFromScratch(wsSettings, sceneName, options = {}) {
  if (!sceneName || !sceneName.trim()) {
    return { success: false, message: 'Scene name is required' };
  }
  const trimmedName = sceneName.trim();
  const { windowTitle, addWindowCapture, addDesktopAudio, addMicAudio } = options;

  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      // Check that the scene doesn't already exist
      const { scenes } = await obs.call('GetSceneList');
      const existingNames = scenes.map(s => s.sceneName);
      if (existingNames.includes(trimmedName)) {
        return { success: false, message: `Scene "${trimmedName}" already exists in OBS` };
      }

      // Create the new (empty) scene
      await obs.call('CreateScene', { sceneName: trimmedName });

      const addedSources = [];
      const sourceErrors = [];

      // Add game/window capture source
      if (addWindowCapture && windowTitle && windowTitle.trim()) {
        const trimmedWindow = windowTitle.trim();
        // Try game_capture first (Windows-only, best for games); fall back to window_capture
        let captureAdded = false;
        try {
          await obs.call('CreateInput', {
            sceneName: trimmedName,
            inputName: `${trimmedName} - Game Capture`,
            inputKind: 'game_capture',
            inputSettings: {
              capture_mode: 'window',
              window: trimmedWindow,
            },
          });
          addedSources.push('game capture');
          captureAdded = true;
        } catch {
          // game_capture unavailable (Linux/macOS); try window_capture
        }

        if (!captureAdded) {
          try {
            await obs.call('CreateInput', {
              sceneName: trimmedName,
              inputName: `${trimmedName} - Window Capture`,
              inputKind: 'window_capture',
              inputSettings: { window: trimmedWindow },
            });
            addedSources.push('window capture');
          } catch (err) {
            sourceErrors.push(`window capture: ${err.message}`);
          }
        }
      }

      // Add desktop audio (output/loopback capture)
      if (addDesktopAudio) {
        try {
          await obs.call('CreateInput', {
            sceneName: trimmedName,
            inputName: `${trimmedName} - Desktop Audio`,
            inputKind: 'wasapi_output_capture',
            inputSettings: {},
          });
          addedSources.push('desktop audio');
        } catch (err) {
          sourceErrors.push(`desktop audio: ${err.message}`);
        }
      }

      // Add microphone (input capture)
      if (addMicAudio) {
        try {
          await obs.call('CreateInput', {
            sceneName: trimmedName,
            inputName: `${trimmedName} - Microphone`,
            inputKind: 'wasapi_input_capture',
            inputSettings: {},
          });
          addedSources.push('microphone');
        } catch (err) {
          sourceErrors.push(`microphone: ${err.message}`);
        }
      }

      let message = `Scene "${trimmedName}" created`;
      if (addedSources.length > 0) {
        message += ` with ${addedSources.join(', ')}`;
      }
      if (sourceErrors.length > 0) {
        message += `. Some sources could not be added: ${sourceErrors.join('; ')}`;
      }
      return { success: true, message };
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to create scene from scratch:', err.message);
    return { success: false, message: err.message };
  }
}

/**
 * Add an audio source (input) to a list of OBS scenes.
 * If the global input already exists it will be reused (scene item added); otherwise a new
 * input is created and placed into each scene.
 *
 * @param {object}   wsSettings  - { host, port, password }
 * @param {string[]} sceneNames  - Scene names to add the source to
 * @param {string}   inputKind   - OBS input kind (e.g. 'wasapi_output_capture')
 * @param {string}   inputName   - Display name for the source
 * @returns {Promise<{ success: boolean, message: string, results: object[] }>}
 */
async function addAudioSourceToScenes(wsSettings, sceneNames, inputKind, inputName, inputSettings = {}) {
  if (!sceneNames || sceneNames.length === 0) {
    return { success: false, message: 'No scene names provided', results: [] };
  }
  if (!inputKind || !inputName) {
    return { success: false, message: 'Input kind and name are required', results: [] };
  }

  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      const results = [];

      for (const sceneName of sceneNames) {
        try {
          // First, check if the source is already in this scene — if so, skip entirely
          const listResult = await obs.call('GetSceneItemList', { sceneName }).catch(() => null);
          const sceneItems = listResult?.sceneItems ?? [];
          const alreadyInScene = sceneItems.some(item => item.sourceName === inputName);
          if (alreadyInScene) {
            results.push({ scene: sceneName, status: 'already present' });
            continue;
          }

          // Try to create a brand-new input and place it in this scene
          try {
            console.log('[obsWebSocket] CreateInput:', JSON.stringify({ sceneName, inputName, inputKind, inputSettings }));
            await obs.call('CreateInput', {
              sceneName,
              inputName,
              inputKind,
              inputSettings: inputSettings || {},
            });
            // Read back what OBS actually stored to verify the window format was accepted
            try {
              const stored = await obs.call('GetInputSettings', { inputName });
              console.log('[obsWebSocket] Stored inputSettings after create:', JSON.stringify(stored.inputSettings));
            } catch {}
            results.push({ scene: sceneName, status: 'added' });
          } catch (createErr) {

            // The input already exists globally — add it as a scene item
            try {
              await obs.call('GetInputSettings', { inputName });
              await obs.call('CreateSceneItem', { sceneName, sourceName: inputName });
              results.push({ scene: sceneName, status: 'added (existing source)' });
            } catch (itemErr) {
              results.push({ scene: sceneName, status: 'error', error: itemErr.message });
            }
          }
        } catch (err) {
          results.push({ scene: sceneName, status: 'error', error: err.message });
        }
      }

      const added = results.filter(r => r.status === 'added').length;
      const skipped = results.filter(r => r.status === 'already present').length;
      const errors = results.filter(r => r.status === 'error').length;
      let message = added > 0 ? `"${inputName}" added to ${added} scene(s)` : `"${inputName}" was already in all scenes`;
      if (skipped > 0) message += ` (skipped ${skipped} that already had it)`;
      if (errors > 0) message += `, ${errors} failed`;
      return { success: added > 0 || skipped > 0, message, results, added, skipped };
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to add audio source to scenes:', err.message);
    return { success: false, message: err.message, results: [] };
  }
}

/**
 * Remove an audio source from a list of OBS scenes by its input name.
 * Removes the scene item from each scene. The global input is not deleted.
 *
 * @param {object}   wsSettings  - { host, port, password }
 * @param {string[]} sceneNames  - Scene names to remove the source from
 * @param {string}   inputName   - Name of the source/input to remove
 * @returns {Promise<{ success: boolean, message: string, results: object[] }>}
 */
async function removeAudioSourceFromScenes(wsSettings, sceneNames, inputName) {
  if (!sceneNames || sceneNames.length === 0) {
    return { success: false, message: 'No scene names provided', results: [] };
  }
  if (!inputName) {
    return { success: false, message: 'Input name is required', results: [] };
  }

  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      const results = [];

      for (const sceneName of sceneNames) {
        try {
          const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
          const matching = sceneItems.filter(item => item.sourceName === inputName);

          if (matching.length === 0) {
            results.push({ scene: sceneName, status: 'not found' });
            continue;
          }

          for (const item of matching) {
            await obs.call('RemoveSceneItem', { sceneName, sceneItemId: item.sceneItemId });
          }
          results.push({ scene: sceneName, status: 'removed' });
        } catch (err) {
          results.push({ scene: sceneName, status: 'error', error: err.message });
        }
      }

      const removed = results.filter(r => r.status === 'removed').length;
      const notFound = results.filter(r => r.status === 'not found').length;
      const errors = results.filter(r => r.status === 'error').length;
      let message = `"${inputName}" removed from ${removed} scene(s)`;
      if (notFound > 0) message += `, not found in ${notFound}`;
      if (errors > 0) message += `, ${errors} failed`;
      return { success: true, message, results };
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to remove audio source from scenes:', err.message);
    return { success: false, message: err.message, results: [] };
  }
}

// The set of OBS input kinds that represent audio sources
const AUDIO_INPUT_KINDS = new Set([
  'wasapi_output_capture',
  'wasapi_input_capture',
  'wasapi_process_output_capture',   // Application Audio Capture (Windows)
  'coreaudio_input_capture',
  'coreaudio_output_capture',
  'pulse_input_capture',
  'pulse_output_capture',
]);

/**
 * Fetch all audio inputs currently registered in OBS.
 * Uses GetInputList filtered to known audio input kinds.
 *
 * @param {object} wsSettings - { host, port, password }
 * @returns {Promise<Array<{ inputName: string, inputKind: string }>>}
 */
async function getOBSAudioInputs(wsSettings) {
  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      const { inputs } = await obs.call('GetInputList');
      return (inputs || [])
        .filter(inp => AUDIO_INPUT_KINDS.has(inp.inputKind))
        .map(inp => ({ inputName: inp.inputName, inputKind: inp.inputKind }));
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to get OBS audio inputs:', err.message);
    throw err;
  }
}

/**
 * Get all audio sources currently in a specific OBS scene.
 * Returns items whose source kind is an audio input kind.
 *
 * @param {object} wsSettings - { host, port, password }
 * @param {string} sceneName - The OBS scene name to query
 * @returns {Promise<Array<{ inputName: string, inputKind: string, sceneItemId: number }>>}
 */
async function getSceneAudioSources(wsSettings, sceneName) {
  if (!sceneName || !sceneName.trim()) {
    return [];
  }
  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: sceneName.trim() });
      if (!sceneItems || sceneItems.length === 0) return [];

      // Filter to items whose source kind is an audio kind.
      // sceneItems contain sourceType and inputKind (OBS 30+); fall back to checking each
      // source's settings via GetInputSettings if inputKind is not directly present.
      const audioItems = [];
      for (const item of sceneItems) {
        // OBS WS v5 typically includes inputKind on sceneItems for inputs
        if (item.inputKind && AUDIO_INPUT_KINDS.has(item.inputKind)) {
          audioItems.push({
            inputName: item.sourceName,
            inputKind: item.inputKind,
            sceneItemId: item.sceneItemId,
          });
        } else if (!item.inputKind) {
          // Try to resolve kind via GetInputSettings (less efficient but safe)
          try {
            const { inputKind } = await obs.call('GetInputKind', { inputName: item.sourceName }).catch(() =>
              obs.call('GetInputSettings', { inputName: item.sourceName })
            );
            if (inputKind && AUDIO_INPUT_KINDS.has(inputKind)) {
              audioItems.push({
                inputName: item.sourceName,
                inputKind,
                sceneItemId: item.sceneItemId,
              });
            }
          } catch {
            // Not an input we can read — skip
          }
        }
      }
      return audioItems;
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to get scene audio sources:', err.message);
    throw err;
  }
}

/**
 * Test the connection to OBS WebSocket.
 * @param {object} wsSettings - { host, port, password }
 * @returns {Promise<{ success: boolean, version?: string, message?: string }>}
 */
async function testOBSConnection(wsSettings) {
  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      const { obsVersion, obsWebSocketVersion } = await obs.call('GetVersion');
      return { success: true, version: `OBS ${obsVersion} (ws ${obsWebSocketVersion})` };
    });
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Get the audio track routing for a specific OBS input.
 * Returns which of the 6 mix tracks this input is active on.
 *
 * @param {object} wsSettings - { host, port, password }
 * @param {string} inputName - The input source name
 * @returns {Promise<{ '1': boolean, '2': boolean, ..., '6': boolean }>}
 */
async function getInputAudioTracks(wsSettings, inputName) {
  if (!inputName) throw new Error('Input name is required');
  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      const { inputAudioTracks } = await obs.call('GetInputAudioTracks', { inputName });
      return inputAudioTracks || {};
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to get input audio tracks:', err.message);
    throw err;
  }
}

/**
 * Set the audio track routing for a specific OBS input.
 *
 * @param {object} wsSettings - { host, port, password }
 * @param {string} inputName - The input source name
 * @param {object} tracks - e.g. { '1': true, '2': false, '3': true, '4': false, '5': false, '6': false }
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function setInputAudioTracks(wsSettings, inputName, tracks) {
  if (!inputName) return { success: false, message: 'Input name is required' };
  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      await obs.call('SetInputAudioTracks', { inputName, inputAudioTracks: tracks });
      return { success: true, message: `Track routing updated for "${inputName}"` };
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to set input audio tracks:', err.message);
    return { success: false, message: err.message };
  }
}

/**
 * Get the names of tracks 1-6 from the OBS active profile.
 * Checks both AdvOut and SimpleOutput categories as different streaming modes use different sections.
 * @returns {Promise<string[]>} Array of 6 track names.
 */
async function getTrackNames(wsSettings) {
  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      const names = ['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6'];
      for (let i = 1; i <= 6; i++) {
        const paramName = `Track${i}Name`;
        try {
          const adv = await obs.call('GetProfileParameter', { parameterCategory: 'AdvOut', parameterName: paramName });
          if (adv.parameterValue) { names[i - 1] = adv.parameterValue; continue; }
        } catch {}
        try {
          const simple = await obs.call('GetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName: paramName });
          if (simple.parameterValue) { names[i - 1] = simple.parameterValue; }
        } catch {}
      }
      return names;
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to get track names:', err.message);
    return ['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6']; // fallback
  }
}

/**
 * Update the names of tracks 1-6 in both Advanced and Simple output properties of the profile.
 * @param {string[]} names Array of 6 track names.
 */
async function setTrackNames(wsSettings, names) {
  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      for (let i = 1; i <= 6; i++) {
        const paramName = `Track${i}Name`;
        const val = names[i - 1] || `Track ${i}`;
        // Set both so they remain in sync regardless of the output mode
        try { await obs.call('SetProfileParameter', { parameterCategory: 'AdvOut', parameterName: paramName, parameterValue: val }); } catch {}
        try { await obs.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName: paramName, parameterValue: val }); } catch {}
      }
      return { success: true };
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to set track names:', err.message);
    throw err;
  }
}

module.exports = { getOBSScenes, createSceneFromTemplate, createSceneFromScratch, addAudioSourceToScenes, removeAudioSourceFromScenes, testOBSConnection, getOBSAudioInputs, getSceneAudioSources, getInputAudioTracks, setInputAudioTracks, getTrackNames, setTrackNames };
