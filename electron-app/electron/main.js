const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// electron-store setup — use a simple JSON file store to avoid ESM issues
const storePath = path.join(app.getPath('userData'), 'config.json');

const storeDefaults = {
  games: [],
  settings: {
    obsRecordingPath: '',
    destinationPath: '',
    clipMarkerHotkey: 'F9',
    autoClip: {
      enabled: false,
      bufferBefore: 15,
      bufferAfter: 15,
      removeMarkers: true,
      deleteFullRecording: false,
    },
    autoDelete: {
      enabled: false,
      maxStorageGB: 50,
      maxAgeDays: 30,
      excludeClips: true,
    },
  },
  windowBounds: { width: 1200, height: 800 },
};

// Simple JSON store (no external dependency)
const store = {
  _data: null,
  _load() {
    if (this._data) return;
    try {
      this._data = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    } catch {
      this._data = { ...storeDefaults };
      this._save();
    }
  },
  _save() {
    fs.writeFileSync(storePath, JSON.stringify(this._data, null, 2), 'utf-8');
  },
  get(key) {
    this._load();
    if (!key) return this._data;
    const keys = key.split('.');
    let val = this._data;
    for (const k of keys) {
      if (val == null) return undefined;
      val = val[k];
    }
    return val !== undefined ? val : keys.reduce((d, k) => d?.[k], storeDefaults);
  },
  set(key, value) {
    this._load();
    const keys = key.split('.');
    let obj = this._data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] == null || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this._save();
  },
};

const { setupGameWatcher } = require('./gameWatcher');
const { setupFileManager } = require('./fileManager');
const { readOBSRecordingPath } = require('./obsIntegration');
const { startApiServer } = require('./apiServer');

let apiServer = null;
let apiPort = null;

// Ensure runtime dir and game_state file exist
const RUNTIME_DIR = path.join(__dirname, '..', '..', 'runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'game_state');

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
let watcherInterval = null;
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
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f0f0f',
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

// Windows - enumerate visible windows for game selector
ipcMain.handle('windows:list', async () => {
  const { execSync } = require('child_process');
  try {
    const cmd = `powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json"`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });
    const parsed = JSON.parse(output);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const systemProcs = ['explorer', 'searchhost', 'textinputhost', 'shellexperiencehost', 'applicationframehost', 'systemsettings', 'mmc'];
    return items
      .filter(p => p.MainWindowTitle && !systemProcs.includes(p.ProcessName.toLowerCase()))
      .map(p => ({
        title: p.MainWindowTitle,
        process: p.ProcessName,
      }));
  } catch {
    return [];
  }
});

// Watcher
ipcMain.handle('watcher:start', () => {
  if (watcherInterval) return { running: true };
  ensureGameState();
  watcherStartedAt = Date.now();
  const result = setupGameWatcher(store, (state) => {
    currentGame = state.currentGame;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('watcher:state', state);
    }
  });
  watcherInterval = result.interval;
  return { running: true };
});
ipcMain.handle('watcher:stop', () => {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    watcherStartedAt = null;
    currentGame = null;
    // Reset game_state file
    try { fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8'); } catch {}
  }
  return { running: false };
});
ipcMain.handle('watcher:status', () => {
  const gameState = readGameState();
  return {
    running: !!watcherInterval,
    currentGame,
    startedAt: watcherStartedAt,
    gameState,
  };
});

// OBS
ipcMain.handle('obs:detect-path', () => readOBSRecordingPath());

// Dialogs
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
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

// IPC: get api port
ipcMain.handle('api:port', () => apiPort);

app.whenReady().then(() => {
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
  });

  createWindow();
  registerHotkey();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (watcherInterval) clearInterval(watcherInterval);
  if (apiServer) apiServer.close();
  globalShortcut.unregisterAll();
  app.quit();
});
