// OBS WebSocket — audio source and track-name helpers.
// Extracted from obsWebSocket.js to keep that file under the 800-line limit.
// All functions connect via withOBSConnection imported from obsWebSocket.js.

const _obsWs = require('./obsWebSocket');

// Mutable refs so tests can inject mock implementations via _inject() without
// having to cross the CJS/ESM boundary that prevents vi.mock('obs-websocket-js')
// from intercepting dynamic import() calls in the required obsWebSocket.js instance.
let withOBSConnection = _obsWs.withOBSConnection;
let fitSourceToCanvas = _obsWs.fitSourceToCanvas;

/** Test-only: replace the connection helpers with mock implementations. */
function _inject(deps) {
  if (deps.withOBSConnection) withOBSConnection = deps.withOBSConnection;
  if (deps.fitSourceToCanvas) fitSourceToCanvas = deps.fitSourceToCanvas;
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
async function addAudioSourceToScenes(wsSettings, sceneNames, inputKind, inputName, inputSettings = {}, options = {}) {
  if (!sceneNames || sceneNames.length === 0) {
    return { success: false, message: 'No scene names provided', results: [] };
  }
  if (!inputKind || !inputName) {
    return { success: false, message: 'Input kind and name are required', results: [] };
  }

  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      const results = [];

      // Fetch canvas dimensions once upfront if any source will need fitting
      let videoSettings = null;
      if (options.fitToCanvas) {
        videoSettings = await obs.call('GetVideoSettings').catch(() => null);
      }

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
            const createResult = await obs.call('CreateInput', {
              sceneName,
              inputName,
              inputKind,
              inputSettings: inputSettings || {},
            });
            if (options.fitToCanvas && createResult?.sceneItemId != null) {
              await fitSourceToCanvas(obs, sceneName, createResult.sceneItemId, videoSettings);
            }
            results.push({ scene: sceneName, status: 'added' });
          } catch (createErr) {

            // The input already exists globally — add it as a scene item
            try {
              await obs.call('GetInputSettings', { inputName });
              const sceneItemResult = await obs.call('CreateSceneItem', { sceneName, sourceName: inputName });
              if (options.fitToCanvas && sceneItemResult?.sceneItemId != null) {
                await fitSourceToCanvas(obs, sceneName, sceneItemResult.sceneItemId, videoSettings);
              }
              results.push({ scene: sceneName, status: 'added (existing source)' });
            } catch (itemErr) {
              results.push({ scene: sceneName, status: 'error', error: itemErr.message });
            }
          }
        } catch (err) {
          results.push({ scene: sceneName, status: 'error', error: err.message });
        }
      }

      const added = results.filter(r => r.status === 'added' || r.status === 'added (existing source)').length;
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
      const settled = await Promise.allSettled(
        sceneNames.map(async (sceneName) => {
          const listResult = await obs.call('GetSceneItemList', { sceneName }).catch(() => null);
          const sceneItems = listResult?.sceneItems ?? [];
          const matching = sceneItems.filter(item => item.sourceName === inputName);
          if (matching.length === 0) return { scene: sceneName, status: 'not found' };
          await Promise.all(
            matching.map(item => obs.call('RemoveSceneItem', { sceneName, sceneItemId: item.sceneItemId }))
          );
          return { scene: sceneName, status: 'removed' };
        })
      );

      const results = settled.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { scene: sceneNames[i], status: 'error', error: r.reason?.message }
      );

      const removed = results.filter(r => r.status === 'removed').length;
      const notFound = results.filter(r => r.status === 'not found').length;
      const errors = results.filter(r => r.status === 'error').length;
      let message = `"${inputName}" removed from ${removed} scene(s)`;
      if (notFound > 0) message += `, not found in ${notFound}`;
      if (errors > 0) message += `, ${errors} failed`;
      return { success: removed > 0, message, results };
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to remove audio source from scenes:', err.message);
    return { success: false, message: err.message, results: [] };
  }
}

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
      const listResult = await obs.call('GetSceneItemList', { sceneName: sceneName.trim() }).catch(() => null);
      const sceneItems = listResult?.sceneItems ?? [];
      if (sceneItems.length === 0) return [];

      // Filter to items whose source kind is an audio kind.
      // sceneItems contain sourceType and inputKind (OBS 30+); fall back to checking each
      // source's settings via GetInputSettings if inputKind is not directly present.
      const resolved = await Promise.all(
        sceneItems.map(async (item) => {
          // OBS WS v5 typically includes inputKind on sceneItems for inputs
          if (item.inputKind && AUDIO_INPUT_KINDS.has(item.inputKind)) {
            const settingsResp = await obs.call('GetInputSettings', { inputName: item.sourceName }).catch(() => null);
            return {
              inputName: item.sourceName,
              inputKind: item.inputKind,
              sceneItemId: item.sceneItemId,
              inputSettings: settingsResp?.inputSettings,
            };
          }
          if (!item.inputKind) {
            // Try to resolve kind via GetInputKind, falling back to GetInputSettings
            try {
              const kindResp = await obs.call('GetInputKind', { inputName: item.sourceName })
                .catch(() => obs.call('GetInputSettings', { inputName: item.sourceName }));
              const inputKind = kindResp?.inputKind;
              if (inputKind && AUDIO_INPUT_KINDS.has(inputKind)) {
                const inputSettings = kindResp?.inputSettings
                  ?? (await obs.call('GetInputSettings', { inputName: item.sourceName }).catch(() => null))?.inputSettings;
                return { inputName: item.sourceName, inputKind, sceneItemId: item.sceneItemId, inputSettings };
              }
            } catch {
              // Not an input we can read — skip
            }
          }
          return null;
        })
      );
      return resolved.filter(Boolean);
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to get scene audio sources:', err.message);
    throw err;
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

module.exports = {
  addAudioSourceToScenes,
  removeAudioSourceFromScenes,
  getOBSAudioInputs,
  getSceneAudioSources,
  getInputAudioTracks,
  setInputAudioTracks,
  getTrackNames,
  setTrackNames,
  _inject,
};
