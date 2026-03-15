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
 * Fit a scene item to the OBS canvas using inner scaling bounds.
 * Non-fatal: silently skips if sceneItemId is missing or OBS calls fail.
 *
 * @param {object} obs - Connected OBS WebSocket instance
 * @param {string} sceneName - Scene that contains the item
 * @param {number|undefined} sceneItemId - ID returned by CreateInput
 */
async function fitSourceToCanvas(obs, sceneName, sceneItemId, videoSettings) {
  if (sceneItemId == null) return;
  try {
    const { baseWidth, baseHeight } = videoSettings ?? await obs.call('GetVideoSettings');
    await obs.call('SetSceneItemTransform', {
      sceneName,
      sceneItemId,
      sceneItemTransform: {
        positionX: 0,
        positionY: 0,
        alignment: 5, // OBS_ALIGN_LEFT | OBS_ALIGN_TOP
        boundsType: 'OBS_BOUNDS_SCALE_INNER',
        boundsAlignment: 0,
        boundsWidth: baseWidth,
        boundsHeight: baseHeight,
      },
    });
  } catch {
    // non-fatal: source is still added; transform falls back to OBS default
  }
}

/**
 * Create a new OBS scene from scratch with optional window capture and audio sources.
 *
 * Steps:
 *  1. Create the new scene
 *  2. Optionally add a game_capture or window_capture source, then fit it to the canvas
 *  3. Optionally add desktop audio (wasapi_output_capture) source
 *  4. Optionally add microphone (wasapi_input_capture) source
 *
 * @param {object} wsSettings - { host, port, password }
 * @param {string} sceneName - Name for the new scene
 * @param {object} [options]
 * @param {string}  [options.windowTitle]     - Window title to use for game/window capture
 * @param {string}  [options.exe]             - Executable filename (e.g. 'game.exe') for the OBS window string
 * @param {string}  [options.windowClass]     - Window class name for the OBS window string
 * @param {boolean} [options.addWindowCapture] - Whether to add a window/game capture source
 * @param {'game_capture'|'window_capture'} [options.captureKind='game_capture']
 *        Controls which OBS source kind to use for the video capture:
 *        'game_capture' uses game_capture (Windows-only, best for full-screen games);
 *        'window_capture' uses window_capture (cross-platform).
 * @param {boolean} [options.addDesktopAudio]  - Whether to add a desktop audio source
 * @param {boolean} [options.addMicAudio]      - Whether to add a microphone audio source
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function createSceneFromScratch(wsSettings, sceneName, options = {}) {
  if (!sceneName || !sceneName.trim()) {
    return { success: false, message: 'Scene name is required' };
  }
  const trimmedName = sceneName.trim();
  const { windowTitle, exe, windowClass, addWindowCapture, addDesktopAudio, addMicAudio, captureKind = 'game_capture' } = options;

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
        // Build OBS window string in canonical Title:Class:Exe format.
        // All three capture kinds (game_capture, window_capture, wasapi_process_output_capture)
        // share the same parser in OBS window-helpers.c: split on ':', index 0=Title, 1=Class, 2=Exe.
        // The bracketed [exe]:Class:Title format is only the UI display label — never a stored value.
        const windowStr = (exe && windowClass)
          ? `${trimmedWindow}:${windowClass}:${exe}`
          : trimmedWindow;

        // captureKind selects the OBS source kind:
        //   'game_capture'  – Windows-only, best for full-screen games
        //   'window_capture'– cross-platform alternative
        if (captureKind === 'window_capture') {
          try {
            const { sceneItemId } = (await obs.call('CreateInput', {
              sceneName: trimmedName,
              inputName: `${trimmedName} - Window Capture`,
              inputKind: 'window_capture',
              inputSettings: { window: windowStr },
            })) ?? {};
            addedSources.push('window capture');
            await fitSourceToCanvas(obs, trimmedName, sceneItemId);
          } catch (err) {
            sourceErrors.push(`window capture: ${err.message}`);
          }
        } else {
          try {
            const { sceneItemId } = (await obs.call('CreateInput', {
              sceneName: trimmedName,
              inputName: `${trimmedName} - Game Capture`,
              inputKind: 'game_capture',
              inputSettings: {
                capture_mode: 'window',
                window: windowStr,
              },
            })) ?? {};
            addedSources.push('game capture');
            await fitSourceToCanvas(obs, trimmedName, sceneItemId);
          } catch (err) {
            sourceErrors.push(`game capture: ${err.message}`);
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
 * Delete an OBS scene by name.
 *
 * @param {object} wsSettings - { host, port, password }
 * @param {string} sceneName  - Name of the scene to delete
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function deleteOBSScene(wsSettings, sceneName) {
  if (!sceneName || !sceneName.trim()) {
    return { success: false, message: 'Scene name is required' };
  }
  const trimmedName = sceneName.trim();
  try {
    return await withOBSConnection(wsSettings, async (obs) => {
      const { scenes, currentProgramSceneName, currentPreviewSceneName } = await obs.call('GetSceneList');
      if (!scenes.some(s => s.sceneName === trimmedName)) {
        return { success: false, message: `Scene "${trimmedName}" does not exist in OBS` };
      }
      // OBS refuses to remove the active program or preview scene.
      // Switch away only if the scene is currently active.
      const fallback = scenes.find(s => s.sceneName !== trimmedName);
      if (fallback) {
        if (currentProgramSceneName === trimmedName) {
          await obs.call('SetCurrentProgramScene', { sceneName: fallback.sceneName }).catch(() => {});
        }
        if (currentPreviewSceneName === trimmedName) {
          await obs.call('SetCurrentPreviewScene', { sceneName: fallback.sceneName }).catch(() => {});
        }
      }
      await obs.call('RemoveScene', { sceneName: trimmedName });
      // Verify removal — OBS may silently refuse on some versions/modes without
      // throwing, or the scene list may lag briefly on headless builds.
      // Retry a few times to handle propagation delay before declaring failure.
      let stillPresent = true;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { scenes: afterScenes } = await obs.call('GetSceneList');
        if (!afterScenes.some(s => s.sceneName === trimmedName)) {
          stillPresent = false;
          break;
        }
        if (attempt < 4) await new Promise(r => setTimeout(r, 200));
      }
      if (stillPresent) {
        return { success: false, message: `Scene "${trimmedName}" could not be removed from OBS` };
      }
      return { success: true, message: `Scene "${trimmedName}" deleted from OBS` };
    });
  } catch (err) {
    console.error('[obsWebSocket] Failed to delete scene:', err.message);
    return { success: false, message: err.message };
  }
}

module.exports = { withOBSConnection, fitSourceToCanvas, getOBSScenes, createSceneFromTemplate, createSceneFromScratch, deleteOBSScene, testOBSConnection };
