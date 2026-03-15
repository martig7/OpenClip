/**
 * OBS WebSocket client for Playwright integration tests.
 *
 * Reads connection details from environment variables set by global-setup.js
 * (which are inherited by the webServer and test workers because globalSetup
 * runs first in Playwright's startup sequence).
 *
 * All test scenes are prefixed with TEST_PREFIX so afterEach cleanup is safe.
 */

import OBSWebSocket from 'obs-websocket-js';

export const OBS_HOST = process.env.OBS_HOST || '127.0.0.1';
export const OBS_PORT = parseInt(process.env.OBS_PORT || '4455', 10);

// All scenes created by integration tests use this prefix for easy cleanup
export const TEST_PREFIX = '[OpenClipTest] ';

export function wsSettings() {
  return { host: OBS_HOST, port: OBS_PORT };
}

export async function withOBS(callback) {
  const obs = new OBSWebSocket();
  await obs.connect(`ws://${OBS_HOST}:${OBS_PORT}`);
  try {
    return await callback(obs);
  } finally {
    await obs.disconnect().catch(() => {});
  }
}

/** Delete all scenes whose names start with TEST_PREFIX. */
export async function cleanupTestScenes() {
  await withOBS(async (obs) => {
    // Switch to the base scene first — OBS refuses to remove the active scene.
    await obs.call('SetCurrentProgramScene', { sceneName: 'Scene' }).catch(() => {});
    const { scenes } = await obs.call('GetSceneList');
    for (const scene of scenes.filter(s => s.sceneName.startsWith(TEST_PREFIX))) {
      await obs.call('RemoveScene', { sceneName: scene.sceneName }).catch(() => {});
    }
  });
}

export async function getScenes() {
  return withOBS(async (obs) => {
    const { scenes } = await obs.call('GetSceneList');
    return scenes.map(s => s.sceneName);
  });
}

export async function createTestScene(label) {
  const name = `${TEST_PREFIX}${label}`;
  await withOBS(async (obs) => {
    const { scenes } = await obs.call('GetSceneList');
    if (!scenes.some(s => s.sceneName === name)) {
      await obs.call('CreateScene', { sceneName: name });
    }
  });
  return name;
}
