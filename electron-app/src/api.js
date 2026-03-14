// When running inside Electron, window.api is injected by preload.js.
// When running in a browser (vite dev without electron), provide a mock.

import { defaultSettings, mockGames, mockRecordings, mockClips, mockStorageStats } from './mockData';

const noop = () => {};
const asyncNoop = async () => null;
const asyncArr = async () => [];

let store = {
  settings: { ...defaultSettings },
  games: [...mockGames],
};

const mockApi = {
  getStore: async (key) => {
    if (key === 'settings') return store.settings;
    if (key === 'games') return store.games;
    return null;
  },
  setStore: async (key, value) => {
    if (key === 'settings') store.settings = value;
    if (key === 'games') store.games = value;
  },
  getGames: async () => store.games,
  addGame: async (game) => {
    const newGame = { enabled: true, ...game, id: Date.now().toString(36) };
    store.games = [...store.games, newGame];
    return store.games;
  },
  removeGame: async (id) => {
    store.games = store.games.filter(g => g.id !== id);
    return store.games;
  },
  toggleGame: async (id) => {
    store.games = store.games.map(g => g.id === id ? { ...g, enabled: !g.enabled } : g);
    return store.games;
  },
  updateGame: async (id, updates) => {
    store.games = store.games.map(g => g.id === id ? { ...g, ...updates } : g);
    return store.games;
  },
  getVisibleWindows: asyncArr,
  extractWindowIcon: asyncNoop,
  startWatcher: async () => ({ running: false }),
  stopWatcher: async () => ({ running: false }),
  getWatcherStatus: async () => ({ running: false, currentGame: null, startedAt: null, gameState: null }),
  onWatcherState: () => noop,
  onWatcherStatusPush: () => noop,
  detectOBSPath: asyncNoop,
  getOBSProfiles: asyncArr,
  getEncodingSettings: asyncNoop,
  setEncodingSettings: asyncNoop,
  isOBSRunning: async () => false,
  launchOBS: async () => ({ success: false, message: 'Not in Electron' }),
  isOBSScriptLoaded: async () => false,
  installOBSPlugin: async () => ({ success: false, message: 'Not in Electron' }),
  isOBSPluginRegistered: async () => false,
  detectOBSInstallPath: asyncNoop,
  setOBSInstallPath: asyncNoop,
  getOBSInstallPath: asyncNoop,
  isOnboardingComplete: async () => true,
  setOnboardingComplete: asyncNoop,
  getOBSWSScenes: asyncArr,
  createOBSScene: async () => ({ success: false, message: 'Not in Electron' }),
  createOBSSceneFromScratch: async () => ({ success: false, message: 'Not in Electron' }),
  deleteOBSScene: async () => ({ success: false, message: 'Not in Electron' }),
  addAudioSourceToScenes: async () => ({ success: false, message: 'Not in Electron', results: [] }),
  removeAudioSourceFromScenes: async () => ({ success: false, message: 'Not in Electron', results: [] }),
  getOBSAudioInputs: async () => [{ inputName: 'Desktop Audio', inputKind: 'wasapi_output_capture' }],
  getSceneAudioSources: async () => [{ inputName: 'Desktop Audio', inputKind: 'wasapi_output_capture', sceneItemId: 1 }],
  getInputAudioTracks: async () => ({ '1': true, '2': true, '3': false, '4': false, '5': false, '6': false }),
  setInputAudioTracks: async () => ({ success: true }),
  getTrackNames: async () => ['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6'],
  setTrackNames: async () => ({ success: true }),
  listWindowsAudioDevices: asyncArr,
  listRunningApps: asyncArr,
  openDirectoryDialog: asyncNoop,
  openFileDialog: asyncNoop,
  showInExplorer: noop,
  openExternal: noop,
  getRecordings: async () => mockRecordings,
  deleteRecording: asyncNoop,
  getVideoURL: asyncNoop,
  organizeRecording: asyncNoop,
  getClips: async () => mockClips,
  createClip: asyncNoop,
  deleteClip: asyncNoop,
  getMarkers: asyncArr,
  deleteMarker: asyncArr,
  onMarkerAdded: () => noop,
  getStorageStats: async () => mockStorageStats,
  registerHotkey: asyncNoop,
  reencodeVideo: asyncNoop,
  checkForUpdate: asyncNoop,
  installUpdate: asyncNoop,
  onUpdateAvailable: () => noop,
  onUpdateProgress: () => noop,
  onUpdateDownloaded: () => noop,
  onUpdateError: () => noop,
};

const api = window.api || mockApi;

export default api;
