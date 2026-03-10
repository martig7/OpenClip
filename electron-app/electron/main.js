const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, protocol, net, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');

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
const electronConfigDefaults = { windowBounds: { width: 1200, height: 800 }, obsRecordingPath: '', listView: true };

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
const { getProfiles, readEncodingSettings, writeEncodingSettings, isOBSRunning } = require('./obsEncoding');
const { getOBSScenes, createSceneFromTemplate, testOBSConnection } = require('./obsWebSocket');
const { readOBSWebSocketQR } = require('./qrCodeReader');
const { startApiServer } = require('./apiServer');
const { RUNTIME_DIR, STATE_FILE, SCRIPT_MARKER_FILE } = require('./constants');

// Seed default config files and OBS Lua script into userData on first run
function seedFirstRun() {
  const defaultsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'defaults')
    : path.join(__dirname, '..', 'resources', 'defaults');
  const luaSrc = app.isPackaged
    ? path.join(process.resourcesPath, 'obs_game_recorder.lua')
    : path.join(__dirname, '..', 'resources', 'obs_game_recorder.lua');

  fs.mkdirSync(USER_DATA, { recursive: true });

  for (const file of ['games_config.json', 'manager_settings.json']) {
    const dest = path.join(USER_DATA, file);
    if (!fs.existsSync(dest)) {
      const src = path.join(defaultsDir, file);
      if (fs.existsSync(src)) try { fs.copyFileSync(src, dest); } catch {}
    }
  }

  // Always overwrite the Lua script on startup — it's app-bundled, not user-edited,
  // so each launch should deploy the latest version.
  const luaDest = path.join(USER_DATA, 'obs_game_recorder.lua');
  if (fs.existsSync(luaSrc)) {
    try {
      fs.copyFileSync(luaSrc, luaDest);
    } catch (err) {
      console.error('[main] Failed to copy Lua script:', err.message);
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
  const { exec } = require('child_process');
  // Allow only safe filename characters to prevent injection and path traversal
  if (!processName || !/^[\w\-. ]+$/.test(processName)) return null;
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  const outPath = path.join(ICONS_DIR, `${path.basename(processName)}.png`);

  // Use PowerShell + System.Drawing to extract the exe's associated icon
  const escaped = outPath.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const cmd = `powershell -NoProfile -Command `
    + `"$p = Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | `
    + `Where-Object {$_.Path} | Select-Object -First 1; `
    + `if ($p) { `
    + `Add-Type -AssemblyName System.Drawing; `
    + `$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p.Path); `
    + `$bmp = $icon.ToBitmap(); `
    + `$bmp.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png); `
    + `Write-Output $p.Path `
    + `} else { Write-Output '' }"`;

  return new Promise((resolve) => {
    exec(cmd, { encoding: 'utf-8', timeout: 8000 }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve(null);
      resolve(fs.existsSync(outPath) ? outPath : null);
    });
  });
});

// Windows - enumerate visible windows for game selector
ipcMain.handle('windows:list', async () => {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    const cmd = `powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json"`;
    exec(cmd, { encoding: 'utf-8', timeout: 5000 }, (error, stdout) => {
      if (error) return resolve([]);
      try {
        const parsed = JSON.parse(stdout);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const systemProcs = ['explorer', 'searchhost', 'textinputhost', 'shellexperiencehost', 'applicationframehost', 'systemsettings', 'mmc'];
        resolve(items
          .filter(p => p.MainWindowTitle && !systemProcs.includes(p.ProcessName.toLowerCase()))
          .map(p => ({
            title: p.MainWindowTitle,
            process: p.ProcessName,
          }))
        );
      } catch {
        resolve([]);
      }
    });
  });
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

// OBS WebSocket
ipcMain.handle('obs:ws:test',          () => testOBSConnection(store.get('settings').obsWebSocket));
ipcMain.handle('obs:ws:script-loaded', () => fs.existsSync(SCRIPT_MARKER_FILE));
ipcMain.handle('obs:ws:scenes', async () => {
  try {
    return await getOBSScenes(store.get('settings').obsWebSocket);
  } catch (err) {
    console.error('[main] obs:ws:scenes error:', err.message);
    throw err; // Re-throw so frontend receives the error
  }
});
ipcMain.handle('obs:ws:create-scene',  (_e, newSceneName, templateSceneName) =>
  createSceneFromTemplate(store.get('settings').obsWebSocket, newSceneName, templateSceneName)
);
ipcMain.handle('obs:ws:read-qr', async (_event, imagePath) => {
  return await readOBSWebSocketQR(imagePath);
});
ipcMain.handle('obs:ws:read-qr-clipboard', async () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return { success: false, message: 'No image in clipboard' };
  }
  
  // Convert native image to PNG buffer
  const buffer = image.toPNG();
  return await readOBSWebSocketQR(buffer);
});
ipcMain.handle('clipboard:hasImage', () => {
  const image = clipboard.readImage();
  return !image.isEmpty();
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
ipcMain.handle('shell:openExternal', (_event, filePath) => {
  shell.openPath(filePath);
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

// OBS script setup — returns the path to the Lua script seeded into userData
ipcMain.handle('obs:script:path', () => path.join(USER_DATA, 'obs_game_recorder.lua'));

// Manual organize a specific recording
ipcMain.handle('recordings:organize', async (_event, { filePath, gameName }) => {
  const { organizeSpecificRecording } = require('./fileManager');
  return organizeSpecificRecording(store, filePath, gameName);
});

// Auto-updater
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', { version: info.version });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:progress', { percent: Math.round(progress.percent) });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:downloaded');
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err.message);
  });

  // Delay check so the UI has time to load
  setTimeout(() => {
    try { autoUpdater.checkForUpdates(); } catch (err) {
      console.error('[updater] check failed:', err.message);
    }
  }, 5000);
}

ipcMain.handle('update:check', () => {
  try { autoUpdater.checkForUpdates(); } catch {}
});

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall();
});

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

  // Auto-updater only runs in packaged builds
  if (app.isPackaged) setupAutoUpdater();

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
