/**
 * Mock OBS Plugin for E2E testing.
 * Provides deterministic responses without requiring a real OBS instance.
 */

const mockScenes = ['Scene', 'Game Capture', 'Desktop Audio'];
const mockAudioInputs = [
  { name: 'Mic/Aux', id: 'audio_input_1' },
  { name: 'Desktop Audio', id: 'audio_output_1' },
];
const mockTrackNames = ['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6'];
const mockSceneItems = {};

let recordingActive = false;
let currentScene = 'Scene';

function resetState() {
  recordingActive = false;
  currentScene = 'Scene';
  mockScenes.length = 0;
  mockScenes.push('Scene', 'Game Capture', 'Desktop Audio');
  mockSceneItems['Scene'] = [
    { sceneItemId: 1, sourceName: 'Desktop Audio', inputKind: 'audio_output' },
    { sceneItemId: 2, sourceName: 'Mic/Aux', inputKind: 'audio_input' },
  ];
  mockSceneItems['Game Capture'] = [
    { sceneItemId: 1, sourceName: 'Game Capture', inputKind: 'game_capture' },
  ];
  mockSceneItems['Desktop Audio'] = [];
}

resetState();

async function callPlugin(method, params = {}) {
  switch (method) {
    case 'getStatus':
      return {
        obsVersion: '30.0.0',
        pluginVersion: '1.0.0',
        recording: recordingActive,
        currentScene,
      };
    case 'getScenes':
      return mockScenes;
    case 'getAudioInputs':
      return mockAudioInputs;
    case 'getSceneItems':
      const sceneName = params.sceneName || currentScene;
      return mockSceneItems[sceneName] || [];
    case 'getSceneAudioSources':
      const scene = params.sceneName || currentScene;
      return mockSceneItems[scene]?.map((item) => item.sourceName) || [];
    case 'getInputAudioTracks':
      return { 1: true, 2: true, 3: false, 4: false, 5: false, 6: false };
    case 'setInputAudioTracks':
      return { success: true };
    case 'getTrackNames':
      return mockTrackNames;
    case 'setTrackNames':
      return { success: true };
    case 'createSceneFromTemplate':
      if (!mockScenes.includes(params.sceneName)) {
        mockScenes.push(params.sceneName);
        mockSceneItems[params.sceneName] = [];
      }
      return { success: true, message: `Scene "${params.sceneName}" created` };
    case 'createSceneFromScratch':
      if (!mockScenes.includes(params.sceneName)) {
        mockScenes.push(params.sceneName);
        mockSceneItems[params.sceneName] = [];
      }
      return { success: true, addedSources: [], errors: [] };
    case 'deleteScene':
      const delIdx = mockScenes.indexOf(params.sceneName);
      if (delIdx > -1) {
        mockScenes.splice(delIdx, 1);
        delete mockSceneItems[params.sceneName];
      }
      return { success: true };
    case 'addSource':
      const targetScene = params.sceneName || currentScene;
      if (!mockSceneItems[targetScene]) {
        mockSceneItems[targetScene] = [];
      }
      const newId = mockSceneItems[targetScene].length + 1;
      mockSceneItems[targetScene].push({
        sceneItemId: newId,
        sourceName: params.inputName,
        inputKind: params.inputKind,
      });
      return { success: true };
    case 'removeSceneItem':
      const remScene = params.sceneName || currentScene;
      const items = mockSceneItems[remScene] || [];
      const remIdx = items.findIndex((i) => i.sceneItemId === params.sceneItemId);
      if (remIdx > -1) {
        items.splice(remIdx, 1);
      }
      return { success: true };
    case 'startRecording':
      recordingActive = true;
      if (params.sceneName) {
        currentScene = params.sceneName;
      }
      return { success: true, message: 'Recording started' };
    case 'stopRecording':
      recordingActive = false;
      return { success: true, message: 'Recording stopped' };
    case 'getRecordingStatus':
      return { recording: recordingActive, currentScene };
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

async function testOBSConnection(_wsSettings) {
  return {
    success: true,
    version: 'OBS 30.0.0 (plugin v1.0.0)',
  };
}

async function getOBSScenes(_wsSettings) {
  return mockScenes;
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
    return { success: true, message: `Scene "${sceneName}" created` };
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
  for (const sceneName of sceneNames) {
    try {
      await callPlugin('addSource', {
        sceneName,
        inputName,
        inputKind,
        inputSettings,
        fitToCanvas: !!options.fitToCanvas,
      });
      results.push({ scene: sceneName, status: 'added' });
    } catch (err) {
      results.push({ scene: sceneName, status: 'error', error: err.message });
    }
  }

  const added = results.filter((r) => r.status === 'added').length;
  const errors = results.filter((r) => r.status === 'error').length;
  return {
    success: errors === 0,
    message: `"${inputName}" added to ${added} scene(s)`,
    results,
    added,
    skipped: sceneNames.length - added - errors,
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
      const items = mockSceneItems[sceneName] || [];
      const matching = items.filter((item) => item.sourceName === inputName);
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

  return {
    success: true,
    message: `"${inputName}" removed from ${sceneNames.length} scene(s)`,
    results,
  };
}

async function getOBSAudioInputs(_wsSettings) {
  return mockAudioInputs;
}

async function getSceneAudioSources(_wsSettings, sceneName) {
  if (!sceneName || !sceneName.trim()) return [];
  return mockSceneItems[sceneName]?.map((item) => item.sourceName) || [];
}

async function getInputAudioTracks(_wsSettings, inputName) {
  return { 1: true, 2: true, 3: false, 4: false, 5: false, 6: false };
}

async function setInputAudioTracks(_wsSettings, inputName, tracks) {
  return { success: true, message: `Track routing updated for "${inputName}"` };
}

async function getTrackNames(_wsSettings) {
  return mockTrackNames;
}

async function setTrackNames(_wsSettings, names) {
  return { success: true };
}

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
  return true;
}

module.exports = {
  testOBSConnection,
  getOBSScenes,
  createSceneFromTemplate,
  createSceneFromScratch,
  deleteOBSScene,
  addAudioSourceToScenes,
  removeAudioSourceFromScenes,
  getOBSAudioInputs,
  getSceneAudioSources,
  getInputAudioTracks,
  setInputAudioTracks,
  getTrackNames,
  setTrackNames,
  startRecording,
  stopRecording,
  getRecordingStatus,
  isPluginReachable,
  callPlugin,
  resetState,
};
