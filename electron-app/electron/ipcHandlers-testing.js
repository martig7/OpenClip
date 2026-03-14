/**
 * Mock IPC Handlers for E2E testing.
 * Provides handlers that work with the test-mode store and mocks.
 */
const { ipcMain, dialog, shell, globalShortcut, app } = require('electron');
const path = require('path');
const fs = require('fs');

const { setupGameWatcher } = require('./gameWatcher-testing');

// Don't require fileManager as it has dependencies that may fail in test mode

// Stub implementations for obsEncoding
function getProfiles() { return ['TestProfile']; }
function readEncodingSettings() { return { encoder: 'x264' }; }
function writeEncodingSettings() { return { success: true }; }
function isOBSRunning() { return false; }
function findOBSExecutable() { return null; }

// Stub for constants
const RUNTIME_DIR = path.join(app.getPath('userData'), 'runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'game_state');
const ICONS_DIR = path.join(app.getPath('userData'), 'icons');

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
} = require('./obsPlugin-testing');

// Stub for autoUpdater
function setupAutoUpdater() { return () => {}; }
function setupDevAutoUpdater() { return () => {}; }
function registerUpdateHandlers() {}

function registerIpcHandlers(store, appState) {
  appState.registerHotkey = () => {};

  ipcMain.handle('store:get', (_event, key) => store.get(key));
  ipcMain.handle('store:set', (_event, key, value) => store.set(key, value));

  ipcMain.handle('games:list', () => store.get('games'));
  ipcMain.handle('games:add', (_event, game) => {
    const games = store.get('games') || [];
    const id = Date.now().toString(36);
    games.push({ id, ...game, enabled: true });
    store.set('games', games);
    return games;
  });
  ipcMain.handle('games:remove', (_event, id) => {
    const games = (store.get('games') || []).filter((g) => g.id !== id);
    store.set('games', games);
    return games;
  });
  ipcMain.handle('games:toggle', (_event, id) => {
    const games = store.get('games') || [];
    const game = games.find((g) => g.id === id);
    if (game) game.enabled = !game.enabled;
    store.set('games', games);
    return games;
  });
  ipcMain.handle('games:update', (_event, id, updates) => {
    const games = store.get('games') || [];
    const game = games.find((g) => g.id === id);
    if (game) Object.assign(game, updates);
    store.set('games', games);
    return games;
  });

  ipcMain.handle('windows:extractIcon', async () => null);

  ipcMain.handle('windows:list', async () => [
    { title: 'Test Window 1', process: 'test1', exe: 'test1.exe', windowClass: 'TestWindow' },
    { title: 'Test Window 2', process: 'test2', exe: 'test2.exe', windowClass: 'TestWindow2' },
  ]);

  ipcMain.handle('windows:list-audio-devices', async () => [
    { name: 'Test Microphone', type: 'input', id: 'test_mic' },
    { name: 'Test Speakers', type: 'output', id: 'test_speakers' },
  ]);

  ipcMain.handle('windows:list-running-apps', async () => [
    { name: 'TestApp1', exe: 'testapp1.exe', hasWindow: true },
    { name: 'TestApp2', exe: 'testapp2.exe', hasWindow: false },
  ]);

  ipcMain.handle('dialog:openDirectory', async () => null);
  ipcMain.handle('dialog:openFile', async () => null);

  ipcMain.handle('shell:showInExplorer', () => {});
  ipcMain.handle('shell:openExternal', () => true);

  // Stub handlers for fileManager (recordings, clips, markers, storage)
  ipcMain.handle('recordings:list', async () => []);
  ipcMain.handle('recordings:delete', async () => ({ success: true }));
  ipcMain.handle('video:getURL', async () => null);
  ipcMain.handle('clips:list', async () => []);
  ipcMain.handle('clips:create', async () => ({ success: true, path: '' }));
  ipcMain.handle('clips:delete', async () => ({ success: true }));
  ipcMain.handle('markers:list', async () => []);
  ipcMain.handle('markers:delete', async () => ({ success: true }));
  ipcMain.handle('storage:stats', async () => ({ totalSize: 0, recordingCount: 0, clipCount: 0, byGame: {} }));
  ipcMain.handle('video:reencode', async () => ({ success: true }));

  ipcMain.handle('hotkey:register', () => true);

  ipcMain.handle('watcher:start', () => {
    if (appState.watcher) return { running: true };
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8');

    appState.watcherStartedAt = Date.now();
    appState.watcher = setupGameWatcher(store, (state) => {
      appState.currentGame = state.currentGame;
      if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
        appState.mainWindow.webContents.send('watcher:status-push', {
          running: !!appState.watcher,
          currentGame: appState.currentGame,
          startedAt: appState.watcherStartedAt,
          gameState: state.status,
        });
      }
    });
    return { running: true };
  });

  ipcMain.handle('watcher:stop', () => {
    if (appState.watcher) {
      appState.watcher.stop();
      appState.watcher = null;
      appState.watcherStartedAt = null;
      appState.currentGame = null;
      try {
        fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8');
      } catch (err) {
        console.error('[test] Failed to write STATE_FILE:', err.message);
      }
    }
    return { running: false };
  });

  ipcMain.handle('watcher:status', () => ({
    running: !!appState.watcher,
    currentGame: appState.currentGame,
    startedAt: appState.watcherStartedAt,
    gameState: 'IDLE',
  }));

  ipcMain.handle('obs:detect-path', () => '/test/recordings');

  ipcMain.handle('obs:profiles', () => ['TestProfile']);
  ipcMain.handle('obs:encoding:get', () => ({}));
  ipcMain.handle('obs:encoding:set', () => ({ success: true }));
  ipcMain.handle('obs:running', () => false);
  ipcMain.handle('obs:launch', async () => ({ success: true }));

  ipcMain.handle('obs:ws:script-loaded', async () => true);
  ipcMain.handle('obs:ws:scenes', async () => ['Scene', 'Game Capture']);
  ipcMain.handle('obs:ws:create-scene', (_e, newSceneName, templateSceneName) =>
    createSceneFromTemplate(undefined, newSceneName, templateSceneName)
  );
  ipcMain.handle('obs:ws:create-scene-scratch', (_e, sceneName, options) =>
    createSceneFromScratch(undefined, sceneName, options)
  );
  ipcMain.handle('obs:ws:delete-scene', (_e, sceneName) =>
    deleteOBSScene(undefined, sceneName)
  );
  ipcMain.handle('obs:ws:add-audio-source', (_e, sceneNames, inputKind, inputName, inputSettings, options) => {
    return addAudioSourceToScenes(undefined, sceneNames, inputKind, inputName, inputSettings || {}, options || {});
  });
  ipcMain.handle('obs:ws:remove-audio-source', (_e, sceneNames, inputName) =>
    removeAudioSourceFromScenes(undefined, sceneNames, inputName)
  );
  ipcMain.handle('obs:ws:get-audio-inputs', async () => [
    { name: 'Mic/Aux', id: 'audio_input_1' },
    { name: 'Desktop Audio', id: 'audio_output_1' },
  ]);
  ipcMain.handle('obs:ws:get-scene-audio-sources', async (_e, sceneName) => []);
  ipcMain.handle('obs:ws:get-input-audio-tracks', async () => ({}));
  ipcMain.handle('obs:ws:set-input-audio-tracks', async (_e, inputName, tracks) => ({
    success: true,
    message: `Track routing updated for "${inputName}"`,
  }));
  ipcMain.handle('obs:ws:get-track-names', () => ['Track 1', 'Track 2', 'Track 3']);
  ipcMain.handle('obs:ws:set-track-names', () => ({ success: true }));

  ipcMain.handle('api:port', async () => 47531);

  ipcMain.handle('onboarding:isComplete', () => true);
  ipcMain.handle('onboarding:setComplete', () => {});

  ipcMain.handle('obs:detect-install', async () => null);
  ipcMain.handle('obs:set-install-path', () => {});
  ipcMain.handle('obs:get-install-path', () => '');

  ipcMain.handle('obs:install-plugin', async () => ({ success: true, path: '/test/plugin' }));
  ipcMain.handle('obs:is-plugin-registered', () => true);
  ipcMain.handle('obs:remove-plugin', async () => ({ success: true }));

  ipcMain.handle('recordings:organize', async () => ({ success: true }));
}

module.exports = { registerIpcHandlers };
