// OBS WebSocket integration using obs-websocket-js (v5 protocol)
// Provides scene listing and scene creation from a template scene.

const DEFAULT_WS_HOST = 'localhost';
const DEFAULT_WS_PORT = 4455;
const CONNECT_TIMEOUT_MS = 5000;

async function getOBSWebSocket() {
  // obs-websocket-js v5 is ESM-only; use dynamic import to load it in CommonJS context
  const mod = await import('obs-websocket-js');
  return mod.default;
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

  // Race connection against a timeout
  await Promise.race([
    obs.connect(url, password),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OBS WebSocket connection timed out')), CONNECT_TIMEOUT_MS)
    ),
  ]);

  try {
    return await callback(obs);
  } finally {
    try { obs.disconnect(); } catch {}
  }
}

/**
 * Retrieve the list of scene names from OBS.
 * @param {object} wsSettings - { host, port, password }
 * @returns {Promise<string[]>} Array of scene names
 */
async function getOBSScenes(wsSettings) {
  return withOBSConnection(wsSettings, async (obs) => {
    const { scenes } = await obs.call('GetSceneList');
    // scenes are returned newest-first; keep that order
    return scenes.map(s => s.sceneName);
  });
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
    throw new Error('New scene name is required');
  }
  const trimmedName = newSceneName.trim();

  return withOBSConnection(wsSettings, async (obs) => {
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

    // Duplicate each item from template into the new scene.
    // DuplicateSceneItem copies the item (and its source) into the destination scene.
    let copiedCount = 0;
    for (const item of sceneItems) {
      try {
        await obs.call('DuplicateSceneItem', {
          sceneName: trimmedTemplate,
          sceneItemId: item.sceneItemId,
          destinationSceneName: trimmedName,
        });
        copiedCount++;
      } catch (err) {
        // Non-fatal: some items (e.g. nested scenes) may fail to duplicate
        console.warn(`[obsWebSocket] Could not duplicate item "${item.sourceName}": ${err.message}`);
      }
    }

    return {
      success: true,
      message: `Scene "${trimmedName}" created with ${copiedCount}/${sceneItems.length} sources from "${trimmedTemplate}"`,
    };
  });
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

module.exports = { getOBSScenes, createSceneFromTemplate, testOBSConnection };
