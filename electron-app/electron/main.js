// ── Elevated-helper mode (must be first) ─────────────────────────────────────
// When ShellExecuteExW re-invokes this executable with --openclip-elevated-helper,
// perform only the requested privileged file ops and exit — no window, no UI.
{
  const _idx = process.argv.indexOf('--openclip-elevated-helper');
  if (_idx !== -1) {
    require('./elevatedHelper').runHelperOp(process.argv[_idx + 1], process.argv[_idx + 2]);
    process.exit(0);
  }
}

const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, protocol, net, clipboard } = require('electron');
const { setupAutoUpdater, setupDevAutoUpdater, devCheckAndDownload, registerUpdateHandlers } = require('./autoUpdater');

// Register custom scheme before app is ready (required by Electron)
// localfile:///C:/path/to/file.png → main process serves the file safely
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
const path = require('path');
const fs = require('fs');

// Force the userData folder to "open-clip" (lowercase, no spaces) instead of the
// productName-derived "Open Clip" to avoid path issues.
app.setPath('userData', path.join(app.getPath('appData'), 'open-clip'));

// Electron-only config (window bounds, OBS recording path which Python reads from OBS profile directly)
const electronConfigPath = path.join(app.getPath('userData'), 'electron.json');
const electronConfigDefaults = { windowBounds: { width: 1200, height: 800 }, obsRecordingPath: '', listView: true, onboardingComplete: false, obsInstallPath: '' };

// All mutable paths come from constants.js (AppData-based)
const { USER_DATA, GAMES_CONFIG_FILE, MANAGER_SETTINGS_FILE, MARKERS_FILE, ICONS_DIR } = require('./constants');

// Defaults for Python JSON files
const gamesConfigDefaults = { games: [] };
const managerSettingsDefaults = {
  organized_path: '',
  auto_organize: true,
  start_watcher_on_startup: false,
  storage_settings: { auto_delete_enabled: false, max_storage_gb: 100, max_age_days: 30, exclude_clips: true },
  locked_recordings: [],
  clip_hotkey: 'F9',
  auto_clip_settings: {
    enabled: false, buffer_before_seconds: 15, buffer_after_seconds: 15,
    remove_processed_markers: true, delete_recording_after_clips: false,
  },
  obs_websocket: { host: 'localhost', port: 4455, password: '' },
};

function readJson(filePath, defaults) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return JSON.parse(JSON.stringify(defaults)); }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Normalize a file-system path: resolve forward/back slashes, remove duplicate separators
function normalizePath(p) {
  if (!p) return p;
  return path.normalize(p);
}

// Translate manager_settings.json → Electron settings shape (camelCase)
function msToElectronSettings(ms, obsRecordingPath, electronData) {
  return {
    obsRecordingPath: normalizePath(obsRecordingPath) || '',
    destinationPath: normalizePath(ms.organized_path) || '',
    startWatcherOnStartup: ms.start_watcher_on_startup || false,
    clipMarkerHotkey: ms.clip_hotkey || 'F9',
    listView: electronData?.listView !== false,
    autoClip: {
      enabled: ms.auto_clip_settings?.enabled || false,
      bufferBefore: ms.auto_clip_settings?.buffer_before_seconds ?? 15,
      bufferAfter: ms.auto_clip_settings?.buffer_after_seconds ?? 15,
      removeMarkers: ms.auto_clip_settings?.remove_processed_markers !== false,
      deleteFullRecording: ms.auto_clip_settings?.delete_recording_after_clips || false,
    },
    autoDelete: {
      enabled: ms.storage_settings?.auto_delete_enabled || false,
      maxStorageGB: ms.storage_settings?.max_storage_gb ?? 100,
      maxAgeDays: ms.storage_settings?.max_age_days ?? 30,
      excludeClips: ms.storage_settings?.exclude_clips !== false,
    },
    obsWebSocket: {
      host: ms.obs_websocket?.host || 'localhost',
      port: ms.obs_websocket?.port ?? 4455,
      password: ms.obs_websocket?.password || '',
    },
  };
}

// Translate Electron settings shape → fields in manager_settings.json
function electronSettingsToMs(ms, electronSettings) {
  const updated = { ...ms };
  if (electronSettings.destinationPath !== undefined) updated.organized_path = normalizePath(electronSettings.destinationPath);
  if (electronSettings.startWatcherOnStartup !== undefined) updated.start_watcher_on_startup = electronSettings.startWatcherOnStartup;
  if (electronSettings.clipMarkerHotkey !== undefined) updated.clip_hotkey = electronSettings.clipMarkerHotkey;
  if (electronSettings.autoClip !== undefined) {
    updated.auto_clip_settings = {
      ...(ms.auto_clip_settings || {}),
      enabled: electronSettings.autoClip.enabled || false,
      buffer_before_seconds: electronSettings.autoClip.bufferBefore ?? 15,
      buffer_after_seconds: electronSettings.autoClip.bufferAfter ?? 15,
      remove_processed_markers: electronSettings.autoClip.removeMarkers !== false,
      delete_recording_after_clips: electronSettings.autoClip.deleteFullRecording || false,
    };
  }
  if (electronSettings.autoDelete !== undefined) {
    updated.storage_settings = {
      ...(ms.storage_settings || {}),
      auto_delete_enabled: electronSettings.autoDelete.enabled || false,
      max_storage_gb: electronSettings.autoDelete.maxStorageGB ?? 100,
      max_age_days: electronSettings.autoDelete.maxAgeDays ?? 30,
      exclude_clips: electronSettings.autoDelete.excludeClips !== false,
    };
  }
  if (electronSettings.obsWebSocket !== undefined) {
    updated.obs_websocket = {
      ...(ms.obs_websocket || {}),
      host: electronSettings.obsWebSocket.host || 'localhost',
      port: electronSettings.obsWebSocket.port ?? 4455,
      password: electronSettings.obsWebSocket.password || '',
    };
  }
  return updated;
}

// Clip markers: runtime/clip_markers.json (Python) ↔ Electron in-memory format
const MAX_MARKERS = 1000;

function loadElectronMarkers() {
  try {
    const data = JSON.parse(fs.readFileSync(MARKERS_FILE, 'utf-8'));
    return (data.markers || []).map(m => ({ game: m.game_name, timestamp: m.timestamp, created: m.created_at }));
  } catch { return []; }
}

function saveElectronMarkers(electronMarkers) {
  const trimmed = electronMarkers.length > MAX_MARKERS
    ? electronMarkers.slice(-MAX_MARKERS)
    : electronMarkers;
  fs.mkdirSync(path.dirname(MARKERS_FILE), { recursive: true });
  writeJson(MARKERS_FILE, {
    markers: trimmed.map(m => ({ game_name: m.game, timestamp: m.timestamp, created_at: m.created })),
  });
}

// Unified store backed by Python JSON files
const store = {
  _gamesData: null,
  _msData: null,
  _electronData: null,

  _games()    { if (!this._gamesData)    this._gamesData    = readJson(GAMES_CONFIG_FILE, gamesConfigDefaults); return this._gamesData; },
  _ms()       { if (!this._msData)       this._msData       = readJson(MANAGER_SETTINGS_FILE, managerSettingsDefaults); return this._msData; },
  _electron() { if (!this._electronData) this._electronData = readJson(electronConfigPath, electronConfigDefaults); return this._electronData; },

  _saveGames()    { writeJson(GAMES_CONFIG_FILE, this._gamesData); },
  _saveMs()       { writeJson(MANAGER_SETTINGS_FILE, this._msData); },
  _saveElectron() { writeJson(electronConfigPath, this._electronData); },

  get(key) {
    if (!key) return null;

    if (key === 'games') {
      const games = this._games().games || [];
      // Assign IDs to any games created by the Python app that don't have one
      let needsSave = false;
      for (const g of games) {
        if (!g.id) {
          g.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          needsSave = true;
        }
      }
      if (needsSave) this._saveGames();
      return games;
    }
    if (key === 'windowBounds') return this._electron().windowBounds || electronConfigDefaults.windowBounds;
    if (key === 'masterAudioSources') return this._electron().masterAudioSources || [];
    if (key === 'audioTracks') return this._electron().audioTracks || {};
    if (key === 'clipMarkers') return loadElectronMarkers();
    if (key === 'lockedRecordings') return this._ms().locked_recordings || [];
    if (key === 'storageSettings') return this._ms().storage_settings || {};

    if (key === 'settings') return msToElectronSettings(this._ms(), this._electron().obsRecordingPath, this._electron());

    if (key.startsWith('settings.')) {
      const subKey = key.slice('settings.'.length);
      const settings = msToElectronSettings(this._ms(), this._electron().obsRecordingPath, this._electron());
      const parts = subKey.split('.');
      let val = settings;
      for (const p of parts) val = val?.[p];
      return val;
    }

    return undefined;
  },

  set(key, value) {
    if (key === 'games') {
      this._games().games = value;
      this._saveGames();
      return;
    }
    if (key === 'windowBounds') {
      this._electron().windowBounds = value;
      this._saveElectron();
      return;
    }
    if (key === 'masterAudioSources') {
      this._electron().masterAudioSources = value;
      this._saveElectron();
      return;
    }
    if (key === 'audioTracks') {
      this._electron().audioTracks = value;
      this._saveElectron();
      return;
    }
    if (key === 'clipMarkers') {
      saveElectronMarkers(value);
      return;
    }
    if (key === 'lockedRecordings') {
      this._ms().locked_recordings = value;
      this._saveMs();
      return;
    }
    if (key === 'storageSettings') {
      this._ms().storage_settings = value;
      this._saveMs();
      return;
    }
    if (key === 'settings') {
      if (value.obsRecordingPath !== undefined) {
        this._electron().obsRecordingPath = normalizePath(value.obsRecordingPath);
        this._saveElectron();
      }
      if (value.listView !== undefined) {
        this._electron().listView = value.listView;
        this._saveElectron();
      }
      this._msData = electronSettingsToMs(this._ms(), value);
      this._saveMs();
      return;
    }
    if (key.startsWith('settings.')) {
      const subKey = key.slice('settings.'.length);
      // obsRecordingPath lives only in electron config
      if (subKey === 'obsRecordingPath') {
        this._electron().obsRecordingPath = normalizePath(value);
        this._saveElectron();
        return;
      }
      // listView lives only in electron config
      if (subKey === 'listView') {
        this._electron().listView = value;
        this._saveElectron();
        return;
      }
      // Build a partial electron settings object for the changed key, then merge
      const current = msToElectronSettings(this._ms(), this._electron().obsRecordingPath, this._electron());
      const parts = subKey.split('.');
      let obj = current;
      for (let i = 0; i < parts.length - 1; i++) {
        obj[parts[i]] = obj[parts[i]] || {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
      this._msData = electronSettingsToMs(this._ms(), current);
      this._saveMs();
      return;
    }
  },
};

const { setupGameWatcher } = require('./gameWatcher');
const { setupFileManager } = require('./fileManager');
const { readOBSRecordingPath } = require('./obsIntegration');
const { getProfiles, readEncodingSettings, writeEncodingSettings, isOBSRunning, findOBSExecutable } = require('./obsEncoding');
const { getVisibleWindowsDetailed, getRunningProcessesDetailed, findProcessPathByName } = require('./processDetector');
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
} = require('./obsPlugin');
const { startApiServer } = require('./apiServer');
const { RUNTIME_DIR, STATE_FILE, PLUGIN_PORT_FILE, PLUGIN_MARKER_FILE, PLUGIN_DLL_NAME } = require('./constants');

// Seed default config files and OBS plugin DLL into userData on first run
function seedFirstRun() {
  const defaultsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'defaults')
    : path.join(__dirname, '..', 'resources', 'defaults');

  fs.mkdirSync(USER_DATA, { recursive: true });

  for (const file of ['games_config.json', 'manager_settings.json']) {
    const dest = path.join(USER_DATA, file);
    if (!fs.existsSync(dest)) {
      const src = path.join(defaultsDir, file);
      if (fs.existsSync(src)) try { fs.copyFileSync(src, dest); } catch {}
    }
  }

  // Always deploy the latest plugin DLL to userData so the install handler can
  // copy it into the OBS plugins directory.
  const pluginSrc = app.isPackaged
    ? path.join(process.resourcesPath, 'obs-plugin', PLUGIN_DLL_NAME)
    : path.join(__dirname, '..', '..', 'obs-plugin', 'build', 'Release', PLUGIN_DLL_NAME);
  const pluginDest = path.join(USER_DATA, PLUGIN_DLL_NAME);
  if (fs.existsSync(pluginSrc)) {
    try {
      fs.copyFileSync(pluginSrc, pluginDest);
    } catch (err) {
      console.error('[main] Failed to copy OBS plugin DLL:', err.message);
    }
  }
}

let apiServer = null;
let apiPort = null;
let apiPortResolve;
const apiPortReady = new Promise(r => { apiPortResolve = r; });

function ensureGameState() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8');
}

function readGameState() {
  try {
    return fs.readFileSync(STATE_FILE, 'utf-8').trim();
  } catch {
    return null;
  }
}

let mainWindow;
let watcher = null;
let watcherStartedAt = null;
let currentGame = null;

function createWindow() {
  const { width, height } = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#181818',
      symbolColor: '#a0a0a0',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('Failed to load:', code, desc);
  });

  let resizeTimer;
  mainWindow.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const [width, height] = mainWindow.getSize();
      store.set('windowBounds', { width, height });
    }, 500);
  });
}

// --- IPC Handlers ---

// Settings
ipcMain.handle('store:get', (_event, key) => store.get(key));
ipcMain.handle('store:set', (_event, key, value) => store.set(key, value));

// Games
ipcMain.handle('games:list', () => store.get('games'));
ipcMain.handle('games:add', (_event, game) => {
  const games = store.get('games');
  const id = Date.now().toString(36);
  games.push({ id, ...game, enabled: true });
  store.set('games', games);
  return games;
});
ipcMain.handle('games:remove', (_event, id) => {
  const games = store.get('games').filter(g => g.id !== id);
  store.set('games', games);
  return games;
});
ipcMain.handle('games:toggle', (_event, id) => {
  const games = store.get('games');
  const game = games.find(g => g.id === id);
  if (game) game.enabled = !game.enabled;
  store.set('games', games);
  return games;
});
ipcMain.handle('games:update', (_event, id, updates) => {
  const games = store.get('games');
  const game = games.find(g => g.id === id);
  if (game) Object.assign(game, updates);
  store.set('games', games);
  return games;
});

// Extract the icon for a running process and save it as a PNG.
// Returns the saved icon path, or null if it couldn't be extracted.
ipcMain.handle('windows:extractIcon', async (_event, processName) => {
  // Allow only safe filename characters to prevent injection and path traversal
  if (!processName || !/^[\w\-. ]+$/.test(processName)) return null;
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  const outPath = path.join(ICONS_DIR, `${path.basename(processName)}.png`);

  const exePath = findProcessPathByName(processName);
  if (!exePath || !fs.existsSync(exePath)) return null;
  try {
    const icon = await app.getFileIcon(exePath, { size: 'normal' });
    const png = icon.toPNG();
    if (!png || !png.length) return null;
    fs.writeFileSync(outPath, png);
    return fs.existsSync(outPath) ? outPath : null;
  } catch {
    return null;
  }
});

// Concurrency guard: limit simultaneous system queries (koffi + reg.exe) to avoid thundering-herd
const SYS_QUERY_MAX_CONCURRENT = 3;
let _sysQueryActive = 0;
const _sysQueryQueue = [];
function runWithSysQueryLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      _sysQueryActive++;
      let result;
      try {
        result = fn();
      } catch (syncErr) {
        _sysQueryActive--;
        if (_sysQueryQueue.length) _sysQueryQueue.shift()();
        resolve([]);
        return;
      }
      Promise.resolve(result).then(resolve, reject).finally(() => {
        _sysQueryActive--;
        if (_sysQueryQueue.length) _sysQueryQueue.shift()();
      });
    };
    if (_sysQueryActive < SYS_QUERY_MAX_CONCURRENT) run();
    else _sysQueryQueue.push(run);
  });
}

// Short-lived caches for expensive system queries.
// Each entry also holds an `inflight` promise so concurrent cold-cache calls share one spawned process.
const _windowsListCache = { data: null, ts: 0, inflight: null };
const _audioDevicesCache = { data: null, ts: 0, inflight: null };
const _runningAppsCache  = { data: null, ts: 0, inflight: null };

function listAudioEndpointsFromRegistry(type) {
  const { execFile } = require('child_process');
  const key = type === 'input'
    ? 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture'
    : 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render';

  return new Promise((resolve) => {
    execFile('reg.exe', ['query', key, '/s', '/v', 'FriendlyName'], { encoding: 'utf-8', timeout: 6000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout) return resolve([]);
      const lines = stdout.split(/\r?\n/);
      const results = [];
      let currentId = '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('HKEY_')) {
          const parts = line.split('\\');
          currentId = parts[parts.length - 1] || '';
          continue;
        }
        const match = line.match(/^FriendlyName\s+REG_\w+\s+(.+)$/i);
        if (!match) continue;
        const name = match[1].trim();
        if (!name) continue;
        results.push({ name, type, id: currentId || name });
      }
      resolve(results);
    });
  });
}

// Windows - enumerate visible windows for game selector
ipcMain.handle('windows:list', async () => {
  const now = Date.now();
  if (_windowsListCache.data !== null && now - _windowsListCache.ts < 5000) return _windowsListCache.data;
  if (_windowsListCache.inflight) return _windowsListCache.inflight;

  _windowsListCache.inflight = runWithSysQueryLimit(() => {
    const systemProcs = new Set(['explorer', 'searchhost', 'textinputhost', 'shellexperiencehost', 'applicationframehost', 'systemsettings', 'mmc']);
    const items = getVisibleWindowsDetailed().filter(w => {
      const proc = (w.process || '').toLowerCase();
      return w.title && !systemProcs.has(proc);
    });
    return Promise.resolve(items);
  }).then((result) => {
    _windowsListCache.data = result;
    _windowsListCache.ts = Date.now();
    _windowsListCache.inflight = null;
    return result;
  }).catch(() => {
    _windowsListCache.inflight = null;
    return [];
  });

  return _windowsListCache.inflight;
});

function pushWatcherStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('watcher:status-push', {
      running: !!watcher,
      currentGame,
      startedAt: watcherStartedAt,
      gameState: readGameState(),
    });
  }
}

// Watcher
ipcMain.handle('watcher:start', () => {
  if (watcher) return { running: true };
  ensureGameState();

  // Run auto-delete pass on startup (non-blocking, errors are swallowed)
  const { runAutoDelete } = require('./recordingService');
  try { runAutoDelete(); } catch {}

  watcherStartedAt = Date.now();
  watcher = setupGameWatcher(store, (state) => {
    currentGame = state.currentGame;
    pushWatcherStatus();
    registerHotkey();
  });
  pushWatcherStatus();
  return { running: true };
});
ipcMain.handle('watcher:stop', () => {
  if (watcher) {
    watcher.stop();
    watcher = null;
    watcherStartedAt = null;
    currentGame = null;
    try { fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8'); } catch {}
  }
  pushWatcherStatus();
  return { running: false };
});
ipcMain.handle('watcher:status', () => {
  const gameState = readGameState();
  return {
    running: !!watcher,
    currentGame,
    startedAt: watcherStartedAt,
    gameState,
  };
});

// OBS
ipcMain.handle('obs:detect-path', () => readOBSRecordingPath());

// OBS Encoding
ipcMain.handle('obs:profiles',      () => getProfiles());
ipcMain.handle('obs:encoding:get',  (_e, profileDir) => readEncodingSettings(profileDir));
ipcMain.handle('obs:encoding:set',  (_e, profileDir, settings) => { writeEncodingSettings(profileDir, settings); return { success: true }; });
ipcMain.handle('obs:running',       () => isOBSRunning());
ipcMain.handle('obs:launch', async () => {
  const obsPath = findOBSExecutable();
  if (!obsPath) return { success: false, message: 'OBS executable not found' };
  const error = await shell.openPath(obsPath);
  if (error) return { success: false, message: error };
  return { success: true };
});

// OBS Plugin
ipcMain.handle('obs:ws:script-loaded', async () => {
  // Check if the native plugin is reachable (replaces the old script marker check)
  try { return await isPluginReachable(); } catch { return false; }
});
ipcMain.handle('obs:ws:scenes', async () => {
  try {
    return await getOBSScenes();
  } catch (err) {
    console.error('[main] obs:ws:scenes error:', err.message);
    throw err; // Re-throw so frontend receives the error
  }
});
ipcMain.handle('obs:ws:create-scene',  (_e, newSceneName, templateSceneName) =>
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
ipcMain.handle('obs:ws:get-audio-inputs', async () => {
  try {
    return await getOBSAudioInputs();
  } catch (err) {
    console.error('[main] obs:ws:get-audio-inputs error:', err.message);
    throw err;
  }
});
ipcMain.handle('obs:ws:get-scene-audio-sources', async (_e, sceneName) => {
  try {
    return await getSceneAudioSources(undefined, sceneName);
  } catch (err) {
    // Expected when OBS/plugin is not running; UI handles this gracefully
    throw err;
  }
});
ipcMain.handle('obs:ws:get-input-audio-tracks', async (_e, inputName) => {
  try {
    return await getInputAudioTracks(undefined, inputName);
  } catch {
    // Expected when OBS/plugin is not running or source not found
    return {};
  }
});
ipcMain.handle('obs:ws:set-input-audio-tracks', async (_e, inputName, tracks) => {
  return setInputAudioTracks(undefined, inputName, tracks);
});
ipcMain.handle('obs:ws:get-track-names', () =>
  getTrackNames()
);
ipcMain.handle('obs:ws:set-track-names', (_e, names) =>
  setTrackNames(undefined, names)
);
ipcMain.handle('windows:list-audio-devices', async () => {
  const now = Date.now();
  if (_audioDevicesCache.data !== null && now - _audioDevicesCache.ts < 10000) return _audioDevicesCache.data;
  if (_audioDevicesCache.inflight) return _audioDevicesCache.inflight;

  _audioDevicesCache.inflight = runWithSysQueryLimit(() => {
    return Promise.all([
      listAudioEndpointsFromRegistry('output'),
      listAudioEndpointsFromRegistry('input'),
    ]).then(([outputs, inputs]) => {
      const dedup = new Map();
      for (const d of [...outputs, ...inputs]) {
        if (!d || !d.name) continue;
        const key = `${d.type}:${d.id}`;
        if (!dedup.has(key)) dedup.set(key, d);
      }
      return [...dedup.values()];
    }).catch(() => []);
  }).then((result) => {
    _audioDevicesCache.data = result;
    _audioDevicesCache.ts = Date.now();
    _audioDevicesCache.inflight = null;
    return result;
  }).catch(() => {
    _audioDevicesCache.inflight = null;
    return [];
  });

  return _audioDevicesCache.inflight;
});
ipcMain.handle('windows:list-running-apps', async () => {
  const now = Date.now();
  if (_runningAppsCache.data !== null && now - _runningAppsCache.ts < 5000) return _runningAppsCache.data;
  if (_runningAppsCache.inflight) return _runningAppsCache.inflight;

  _runningAppsCache.inflight = runWithSysQueryLimit(() => {
    const skipList = new Set(['svchost','conhost','csrss','dwm','smss','lsass','wininit','services','registry','idle','system','audiodg','runtimebroker','searchhost','textinputhost','shellexperiencehost','applicationframehost','startmenuexperiencehost','systemsettings','taskhostw','sihost','fontdrvhost','nissrv','msmpeng']);
    const seen = new Map();
    for (const p of getRunningProcessesDetailed()) {
      if (!p || !p.name) continue;
      const name = p.name.toLowerCase();
      if (name.startsWith('[') || name.endsWith(']')) continue;
      if (skipList.has(name)) continue;
      if (!seen.has(name) || p.hasWindow) {
        seen.set(name, { name: p.name, exe: p.exe || `${p.name}.exe`, hasWindow: !!p.hasWindow });
      }
    }
    return Promise.resolve([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }).then((result) => {
    _runningAppsCache.data = result;
    _runningAppsCache.ts = Date.now();
    _runningAppsCache.inflight = null;
    return result;
  }).catch(() => {
    _runningAppsCache.inflight = null;
    return [];
  });

  return _runningAppsCache.inflight;
});
// Dialogs
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('dialog:openFile', async (_event, opts = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], ...opts });
  return result.canceled ? null : result.filePaths[0];
});

// File operations
ipcMain.handle('shell:showInExplorer', (_event, filePath) => {
  shell.showItemInFolder(filePath);
});
ipcMain.handle('shell:openExternal', (_event, url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const allowed = ['http:', 'https:', 'mailto:'];
  if (!allowed.includes(parsed.protocol)) return false;
  return shell.openExternal(url);
});

// Recordings & Clips (delegated to fileManager)
setupFileManager(ipcMain, store);

// Clip marker hotkey
function registerHotkey() {
  globalShortcut.unregisterAll();
  const hotkey = store.get('settings.clipMarkerHotkey');
  if (hotkey && currentGame) {
    globalShortcut.register(hotkey, () => {
      const markers = store.get('clipMarkers') || [];
      markers.push({
        game: currentGame,
        timestamp: Date.now() / 1000,
        created: new Date().toISOString(),
      });
      store.set('clipMarkers', markers);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('clip:marker-added', markers.length);
      }
    });
  }
}

ipcMain.handle('hotkey:register', () => {
  registerHotkey();
  return true;
});

// IPC: get api port (waits until server is listening)
ipcMain.handle('api:port', async () => {
  await apiPortReady;
  return apiPort;
});

// OBS plugin path — returns the install location of the native OBS plugin DLL
// Onboarding
ipcMain.handle('onboarding:isComplete', () => {
  return store._electron().onboardingComplete === true;
});
ipcMain.handle('onboarding:setComplete', (_event, value) => {
  store._electron().onboardingComplete = !!value;
  store._saveElectron();
});

// Detect OBS installation directory (where obs64.exe lives)
ipcMain.handle('obs:detect-install', async () => {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  // Common install locations to probe
  const candidates = [
    path.join(process.env.ProgramFiles  || 'C:\\Program Files',       'obs-studio'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'obs-studio'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'obs-studio'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'bin', '64bit', 'obs64.exe'))) return dir;
  }
  // Try reading from Windows registry (Steam / custom installs)
  try {
    const { stdout: regOut } = await execAsync(
      'reg query "HKLM\\SOFTWARE\\OBS Studio" /v "" 2>nul || reg query "HKLM\\SOFTWARE\\WOW6432Node\\OBS Studio" /v "" 2>nul',
      { encoding: 'utf-8', timeout: 3000 }
    );
    const match = regOut.match(/\(Default\)\s+REG_SZ\s+(.+)/);
    if (match) {
      const dir = match[1].trim();
      if (fs.existsSync(path.join(dir, 'bin', '64bit', 'obs64.exe'))) return dir;
    }
  } catch {}
  return null;
});

// Store obs install path
ipcMain.handle('obs:set-install-path', (_event, installPath) => {
  store._electron().obsInstallPath = installPath || '';
  store._saveElectron();
});
ipcMain.handle('obs:get-install-path', () => {
  return store._electron().obsInstallPath || '';
});

/**
 * Run a privileged file operation via ShellExecuteExW("runas") — no PowerShell.
 * Lazy-requires elevatedRunner so koffi DLL bindings are only initialised on demand.
 * Returns { success, message? }.
 */
function runElevatedOp(operation) {
  let _run;
  try {
    ({ runElevatedOp: _run } = require('./elevatedRunner'));
  } catch (err) {
    return { success: false, errorKind: 'dependency-missing', message: `Elevation helper could not initialize: ${err.message}` };
  }
  return _run(operation);
}

// Auto-install: copy the OBS plugin DLL to both the system obs-plugins\64bit folder
// (auto-discovered by OBS) and the per-user AppData path (for OBS v28+ per-user support).
// Writing to Program Files requires elevation; we try direct copy first and fall back to UAC.
ipcMain.handle('obs:install-plugin', async (_event, obsInstallPath) => {
  try {
    if (!obsInstallPath || !path.isAbsolute(obsInstallPath)) {
      return { success: false, message: 'OBS install folder is required. Set it in Settings before installing.' };
    }

    if (await isOBSRunning()) {
      return { success: false, message: 'OBS is currently open. Please close OBS before installing the plugin.' };
    }

    // Locate the plugin DLL bundled with the app
    let dllSrc;
    if (app.isPackaged) {
      dllSrc = path.join(process.resourcesPath, 'obs-plugin', PLUGIN_DLL_NAME);
    } else {
      const devBuild = path.join(__dirname, '..', '..', 'obs-plugin', 'build', 'Release', PLUGIN_DLL_NAME);
      const resBuild = path.join(__dirname, '..', 'resources', 'obs-plugin', PLUGIN_DLL_NAME);
      if (fs.existsSync(devBuild)) dllSrc = devBuild;
      else if (fs.existsSync(resBuild)) dllSrc = resBuild;
      else return { success: false, message: 'Plugin DLL not found (build it first or place in resources/obs-plugin/)' };
    }

    if (!fs.existsSync(dllSrc)) {
      return { success: false, message: `Plugin DLL not found at ${dllSrc}` };
    }

    // ── 1. Program Files (system-wide, auto-discovered by OBS) ───────────────
    const sysPluginDir = path.join(obsInstallPath, 'obs-plugins', '64bit');
    const sysDest      = path.join(sysPluginDir, PLUGIN_DLL_NAME);
    const sysLocaleDir = path.join(obsInstallPath, 'data', 'obs-plugins', 'openclip-obs', 'locale');
    const sysLocale    = path.join(sysLocaleDir, 'en-US.ini');

    let needsElevation = false;
    try {
      fs.mkdirSync(sysPluginDir, { recursive: true });
      fs.copyFileSync(dllSrc, sysDest);
      fs.mkdirSync(sysLocaleDir, { recursive: true });
      if (!fs.existsSync(sysLocale)) fs.writeFileSync(sysLocale, '');
      console.log(`[main] Plugin installed (system) to ${sysDest}`);
    } catch (fsErr) {
      if (fsErr.code === 'EPERM' || fsErr.code === 'EACCES' || fsErr.code === 'EBUSY') {
        needsElevation = true;
      } else {
        throw fsErr;
      }
    }

    if (needsElevation) {
      const elevResult = runElevatedOp({ op: 'install-plugin', dllSrc, sysDest, sysPluginDir, sysLocaleDir, sysLocale });
      if (!elevResult.success) return elevResult;
      console.log(`[main] Plugin installed (system, elevated) to ${sysDest}`);
    }

    // ── 2. AppData per-user path (OBS v28+ alternative scan path) ────────────
    const userBase      = path.join(app.getPath('appData'), 'obs-studio', 'plugins', 'openclip-obs');
    const userPluginDir = path.join(userBase, 'obs-plugins', '64bit');
    const userDest      = path.join(userPluginDir, PLUGIN_DLL_NAME);
    const userLocaleDir = path.join(userBase, 'data', 'obs-plugins', 'openclip-obs', 'locale');
    const userLocale    = path.join(userLocaleDir, 'en-US.ini');

    try {
      fs.mkdirSync(userPluginDir, { recursive: true });
      fs.copyFileSync(dllSrc, userDest);
      fs.mkdirSync(userLocaleDir, { recursive: true });
      if (!fs.existsSync(userLocale)) fs.writeFileSync(userLocale, '');
      console.log(`[main] Plugin installed (user) to ${userDest}`);
    } catch (userErr) {
      console.warn('[main] Could not install to AppData path:', userErr.message);
    }

    // Write modules.json entry — OBS won't auto-add our plugin from the discovery
    // scan (it silently skips DLLs that fail its load probe), but it WILL load plugins
    // that are already listed in modules.json with enabled:true.
    try {
      const modulesJson = path.join(app.getPath('appData'), 'obs-studio', 'plugin_manager', 'modules.json');
      let modules = [];
      if (fs.existsSync(modulesJson)) {
        try { modules = JSON.parse(fs.readFileSync(modulesJson, 'utf-8')); } catch {}
      }
      const existing = modules.find(m => m.module_name === 'openclip-obs');
      if (existing) {
        existing.enabled = true;
        if (!existing.display_name) existing.display_name = 'OpenClip';
        if (!('id' in existing)) existing.id = '';
        if (!('version' in existing)) existing.version = '';
      } else {
        modules.push({ display_name: 'OpenClip', enabled: true, encoders: [], id: '', module_name: 'openclip-obs', outputs: [], services: [], sources: [], version: '' });
      }
      fs.mkdirSync(path.dirname(modulesJson), { recursive: true });
      fs.writeFileSync(modulesJson, JSON.stringify(modules, null, 4));
      console.log('[main] modules.json updated — openclip-obs enabled');
    } catch (jsonErr) {
      console.warn('[main] Could not patch modules.json:', jsonErr.message);
    }

    return { success: true, path: sysDest };
  } catch (err) {
    console.error('[main] Plugin install error:', err.message);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('obs:is-plugin-registered', () => {
  try {
    const obsInstallPath = store._electron().obsInstallPath || '';
    if (obsInstallPath) {
      if (fs.existsSync(path.join(obsInstallPath, 'obs-plugins', '64bit', PLUGIN_DLL_NAME))) return true;
    }
    if (fs.existsSync(path.join(app.getPath('appData'), 'obs-studio', 'plugins', 'openclip-obs', 'obs-plugins', '64bit', PLUGIN_DLL_NAME))) return true;
    return false;
  } catch {
    return false;
  }
});

// Remove the native OBS plugin DLL from all install locations
ipcMain.handle('obs:remove-plugin', async () => {
  try {
    if (await isOBSRunning()) {
      return { success: false, message: 'OBS is currently open. Please close OBS before removing the plugin.' };
    }

    // Remove from Program Files (may need elevation)
    const obsInstallPath = store._electron().obsInstallPath || '';
    if (obsInstallPath) {
      const sysDest   = path.join(obsInstallPath, 'obs-plugins', '64bit', PLUGIN_DLL_NAME);
      const sysLocale = path.join(obsInstallPath, 'data', 'obs-plugins', 'openclip-obs');
      if (fs.existsSync(sysDest)) {
        let needsElevation = false;
        try {
          fs.rmSync(sysDest, { force: true });
          if (fs.existsSync(sysLocale)) fs.rmSync(sysLocale, { recursive: true, force: true });
          console.log(`[main] Removed system plugin: ${sysDest}`);
        } catch (fsErr) {
          if (fsErr.code === 'EPERM' || fsErr.code === 'EACCES' || fsErr.code === 'EBUSY') needsElevation = true;
        }
        if (needsElevation) {
          runElevatedOp({ op: 'remove-plugin', sysDest, sysLocale });
        }
      }
    }

    // Remove from AppData per-user path
    const userBase = path.join(app.getPath('appData'), 'obs-studio', 'plugins', 'openclip-obs');
    if (fs.existsSync(userBase)) {
      fs.rmSync(userBase, { recursive: true, force: true });
      console.log(`[main] Removed user plugin folder: ${userBase}`);
    }

    // Remove from modules.json so OBS doesn't show a stale greyed-out entry
    try {
      const modulesJson = path.join(app.getPath('appData'), 'obs-studio', 'plugin_manager', 'modules.json');
      if (fs.existsSync(modulesJson)) {
        let modules = JSON.parse(fs.readFileSync(modulesJson, 'utf-8'));
        const filtered = modules.filter(m => m.module_name !== 'openclip-obs');
        if (filtered.length !== modules.length) {
          fs.writeFileSync(modulesJson, JSON.stringify(filtered, null, 4));
          console.log('[main] Removed openclip-obs from modules.json');
        }
      }
    } catch (jsonErr) {
      console.warn('[main] Could not update modules.json on remove:', jsonErr.message);
    }

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Manual organize a specific recording
ipcMain.handle('recordings:organize', async (_event, { filePath, gameName }) => {
  const { organizeSpecificRecording } = require('./fileManager');
  return organizeSpecificRecording(store, filePath, gameName);
});

// Auto-updater IPC handlers (safe to register before app is ready)
registerUpdateHandlers(ipcMain, () => mainWindow);

app.whenReady().then(() => {
  // Serve local filesystem files (e.g. game icons) via localfile:// protocol.
  // file:// is blocked by Electron's security model when loaded from a different origin.
  protocol.handle('localfile', (request) => {
    const filePath = new URL(request.url).pathname.slice(1); // strip leading /
    return net.fetch(`file:///${filePath}`);
  });

  // Seed default configs and OBS script into AppData on first run
  seedFirstRun();
  // Ensure runtime and icons directories exist in AppData
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  ensureGameState();

  // Auto-detect OBS recording path on startup if not set
  if (!store.get('settings.obsRecordingPath')) {
    const detected = readOBSRecordingPath();
    if (detected) store.set('settings.obsRecordingPath', detected);
  }

  // Start the API server
  apiServer = startApiServer(store);
  apiServer.on('listening', () => {
    apiPort = apiServer.address().port;
    console.log(`API server on port ${apiPort}`);
    apiPortResolve();
  });

  createWindow();
  registerHotkey();

  // In production, run the full auto-updater (checks, downloads, and installs on quit).
  // In dev, wire up events and settings so a manual check triggers a real check+download
  // against GitHub releases, but stops short of installing.
  if (app.isPackaged) {
    setupAutoUpdater(() => mainWindow);
  } else {
    setupDevAutoUpdater(() => mainWindow);
  }

  // Auto-start watcher on startup if configured
  if (store.get('settings.startWatcherOnStartup')) {
    ensureGameState();
    const { runAutoDelete } = require('./recordingService');
    try { runAutoDelete(); } catch {}
    watcherStartedAt = Date.now();
    watcher = setupGameWatcher(store, (state) => {
      currentGame = state.currentGame;
      pushWatcherStatus();
      registerHotkey();
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (watcher) watcher.stop();
  if (apiServer) apiServer.close();
  globalShortcut.unregisterAll();
  const { killAllProcesses } = require('./recordingService');
  killAllProcesses();
  app.quit();
});
