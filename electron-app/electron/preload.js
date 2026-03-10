const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Store
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),

  // Games
  getGames: () => ipcRenderer.invoke('games:list'),
  addGame: (game) => ipcRenderer.invoke('games:add', game),
  removeGame: (id) => ipcRenderer.invoke('games:remove', id),
  toggleGame: (id) => ipcRenderer.invoke('games:toggle', id),
  updateGame: (id, updates) => ipcRenderer.invoke('games:update', id, updates),

  // Windows
  getVisibleWindows: () => ipcRenderer.invoke('windows:list'),
  extractWindowIcon: (processName) => ipcRenderer.invoke('windows:extractIcon', processName),

  // Watcher
  startWatcher: () => ipcRenderer.invoke('watcher:start'),
  stopWatcher: () => ipcRenderer.invoke('watcher:stop'),
  getWatcherStatus: () => ipcRenderer.invoke('watcher:status'),
  onWatcherState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('watcher:state', handler);
    return () => ipcRenderer.removeListener('watcher:state', handler);
  },
  onWatcherStatusPush: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('watcher:status-push', handler);
    return () => ipcRenderer.removeListener('watcher:status-push', handler);
  },

  // OBS
  detectOBSPath: () => ipcRenderer.invoke('obs:detect-path'),
  getOBSProfiles: () => ipcRenderer.invoke('obs:profiles'),
  getEncodingSettings: (profileDir) => ipcRenderer.invoke('obs:encoding:get', profileDir),
  setEncodingSettings: (profileDir, settings) => ipcRenderer.invoke('obs:encoding:set', profileDir, settings),
  isOBSRunning: () => ipcRenderer.invoke('obs:running'),
  getOBSScriptPath: () => ipcRenderer.invoke('obs:script:path'),

  // OBS WebSocket
  testOBSWSConnection: () => ipcRenderer.invoke('obs:ws:test'),
  isOBSScriptLoaded: () => ipcRenderer.invoke('obs:ws:script-loaded'),
  getOBSWSScenes: () => ipcRenderer.invoke('obs:ws:scenes'),
  createOBSScene: (newSceneName, templateSceneName) => ipcRenderer.invoke('obs:ws:create-scene', newSceneName, templateSceneName),
  createOBSSceneFromScratch: (sceneName, options) => ipcRenderer.invoke('obs:ws:create-scene-scratch', sceneName, options),
  readOBSWSQR: (imagePath) => ipcRenderer.invoke('obs:ws:read-qr', imagePath),
  readOBSWSQRFromClipboard: () => ipcRenderer.invoke('obs:ws:read-qr-clipboard'),
  clipboardHasImage: () => ipcRenderer.invoke('clipboard:hasImage'),

  // Dialogs
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  openFileDialog: (opts) => ipcRenderer.invoke('dialog:openFile', opts),

  // Shell
  showInExplorer: (path) => ipcRenderer.invoke('shell:showInExplorer', path),
  openExternal: (path) => ipcRenderer.invoke('shell:openExternal', path),

  // Recordings
  getRecordings: () => ipcRenderer.invoke('recordings:list'),
  deleteRecording: (path) => ipcRenderer.invoke('recordings:delete', path),
  getVideoURL: (filePath) => ipcRenderer.invoke('video:getURL', filePath),
  organizeRecording: (filePath, gameName) => ipcRenderer.invoke('recordings:organize', { filePath, gameName }),

  // Clips
  getClips: () => ipcRenderer.invoke('clips:list'),
  createClip: (opts) => ipcRenderer.invoke('clips:create', opts),
  deleteClip: (path) => ipcRenderer.invoke('clips:delete', path),

  // Markers
  getMarkers: () => ipcRenderer.invoke('markers:list'),
  deleteMarker: (index) => ipcRenderer.invoke('markers:delete', index),
  onMarkerAdded: (callback) => {
    const handler = (_event, count) => callback(count);
    ipcRenderer.on('clip:marker-added', handler);
    return () => ipcRenderer.removeListener('clip:marker-added', handler);
  },

  // Storage
  getStorageStats: () => ipcRenderer.invoke('storage:stats'),

  // Hotkey
  registerHotkey: () => ipcRenderer.invoke('hotkey:register'),

  // Re-encode
  reencodeVideo: (opts) => ipcRenderer.invoke('video:reencode', opts),

  // API server port
  getApiPort: () => ipcRenderer.invoke('api:port'),

  // Auto-updater
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  onUpdateDownloaded: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('update:downloaded', handler);
    return () => ipcRenderer.removeListener('update:downloaded', handler);
  },
});
