// When running inside Electron, window.api is injected by preload.js.
// When running in a browser (vite dev without electron), provide a mock.

const noop = () => {};
const asyncNoop = async () => null;
const asyncArr = async () => [];
const asyncObj = async (val) => val;

const mockApi = {
  getStore: asyncNoop,
  setStore: asyncNoop,
  getGames: asyncArr,
  addGame: asyncArr,
  removeGame: asyncArr,
  toggleGame: asyncArr,
  updateGame: asyncArr,
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
  testOBSWSConnection: async () => ({ success: false, message: 'Not in Electron' }),
  isOBSScriptLoaded: async () => false,
  getOBSScriptPath: async () => '',
  getOBSWSScenes: asyncArr,
  createOBSScene: async () => ({ success: false, message: 'Not in Electron' }),
  createOBSSceneFromScratch: async () => ({ success: false, message: 'Not in Electron' }),
  addAudioSourceToScenes: async () => ({ success: false, message: 'Not in Electron', results: [] }),
  removeAudioSourceFromScenes: async () => ({ success: false, message: 'Not in Electron', results: [] }),
  getOBSAudioInputs: asyncArr,
  getSceneAudioSources: asyncArr,
  listWindowsAudioDevices: asyncArr,
  readOBSWSQR: async () => ({ success: false, message: 'Not in Electron' }),
  readOBSWSQRFromClipboard: async () => ({ success: false, message: 'Not in Electron' }),
  clipboardHasImage: async () => false,
  openDirectoryDialog: asyncNoop,
  openFileDialog: asyncNoop,
  showInExplorer: noop,
  openExternal: noop,
  getRecordings: asyncArr,
  deleteRecording: asyncNoop,
  getVideoURL: asyncNoop,
  organizeRecording: asyncNoop,
  getClips: asyncArr,
  createClip: asyncNoop,
  deleteClip: asyncNoop,
  getMarkers: asyncArr,
  deleteMarker: asyncArr,
  onMarkerAdded: () => noop,
  getStorageStats: async () => ({ totalSize: 0, recordingCount: 0, clipCount: 0, byGame: {} }),
  registerHotkey: asyncNoop,
  reencodeVideo: asyncNoop,
};

const api = window.api || mockApi;

export default api;
