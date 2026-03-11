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
  launchOBS: async () => ({ success: false, message: 'Not in Electron' }),
  testOBSWSConnection: async () => ({ success: false, message: 'Not in Electron' }),
  isOBSScriptLoaded: async () => false,
  getOBSScriptPath: async () => '',
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
