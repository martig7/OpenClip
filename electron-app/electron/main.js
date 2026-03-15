const { app, BrowserWindow, ipcMain, globalShortcut, protocol, net } = require('electron');

const isTestMode = process.env.OPENCLIP_TEST_MODE === 'true' || process.argv.includes('--test-mode');
const isIntegrationMode = process.env.OPENCLIP_INTEGRATION_TEST === 'true' || process.argv.includes('--integration-mode');

// Register custom scheme before app is ready (required by Electron)
// localfile:///C:/path/to/file.png → main process serves the file safely
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
const path = require('path');
const fs = require('fs');

// Force the userData folder to "open-clip" (lowercase, no spaces) instead of the
// productName-derived "Open Clip" to avoid path issues.
// Integration mode uses an isolated data directory so it never touches production config.
const userDataName = isIntegrationMode ? 'open-clip-integration' : 'open-clip';
app.setPath('userData', path.join(app.getPath('appData'), userDataName));

// Get constants that work in both modes
const PLUGIN_DLL_NAME = process.platform === 'win32' ? 'openclip-obs.dll' : process.platform === 'darwin' ? 'openclip-obs.dylib' : 'openclip-obs.so';
const USER_DATA = app.getPath('userData');

// store.js must be required AFTER app.setPath('userData', ...) is called above
// In test mode, use the in-memory store
let store, registerIpcHandlers, setupGameWatcher, readOBSRecordingPath, startApiServer, setupAutoUpdater, setupDevAutoUpdater, RUNTIME_DIR, STATE_FILE, ICONS_DIR;

if (isTestMode) {
  const testStore = require('./store-testing');
  store = testStore.store;
  const testIpcHandlers = require('./ipcHandlers-testing');
  registerIpcHandlers = testIpcHandlers.registerIpcHandlers;
  const testGameWatcher = require('./gameWatcher-testing');
  setupGameWatcher = testGameWatcher.setupGameWatcher;
  const testObsIntegration = require('./obsIntegration-testing');
  readOBSRecordingPath = testObsIntegration.readOBSRecordingPath;
  ({ startApiServer } = require('./apiServer-testing'));
  setupAutoUpdater = () => {};
  setupDevAutoUpdater = () => {};
  RUNTIME_DIR = path.join(USER_DATA, 'runtime');
  STATE_FILE = path.join(RUNTIME_DIR, 'game_state');
  ICONS_DIR = path.join(USER_DATA, 'icons');
} else {
  // Integration and production both use real modules. The only difference is
  // the auto-updater: integration mode disables it to avoid update prompts
  // during tests.
  const realStore = require('./store');
  store = realStore.store;
  ({ registerIpcHandlers } = require('./ipcHandlers'));
  ({ setupGameWatcher } = require('./gameWatcher'));
  ({ readOBSRecordingPath } = require('./obsIntegration'));
  ({ startApiServer } = require('./apiServer'));
  ({ RUNTIME_DIR, STATE_FILE, ICONS_DIR } = require('./constants'));
  if (isIntegrationMode) {
    setupAutoUpdater = () => {};
    setupDevAutoUpdater = () => {};
  } else {
    ({ setupAutoUpdater, setupDevAutoUpdater } = require('./autoUpdater'));
  }
}

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
let apiPortResolve;
const apiPortReady = new Promise(r => { apiPortResolve = r; });

// Shared mutable state exposed to ipcHandlers via appState
const appState = {
  mainWindow: null,
  watcher: null,
  watcherStartedAt: null,
  currentGame: null,
  apiPort: null,
  apiPortReady,
  registerHotkey: null, // set by registerIpcHandlers
};

function ensureGameState() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8');
}

function createWindow() {
  const { width, height } = store.get('windowBounds');

  appState.mainWindow = new BrowserWindow({
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
    appState.mainWindow.loadURL('http://localhost:5173');
  } else {
    appState.mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  if (isDev) {
    appState.mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  appState.mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('Failed to load:', code, desc);
  });

  let resizeTimer;
  appState.mainWindow.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const [width, height] = appState.mainWindow.getSize();
      store.set('windowBounds', { width, height });
    }, 500);
  });
}

// Register all IPC handlers (safe to register before app is ready)
registerIpcHandlers(store, appState);

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

  // Integration mode: seed store with Docker OBS connection and test paths.
  // Environment variables override any persisted values so tests get a predictable state.
  if (isIntegrationMode) {
    store.set('settings.obsWebSocket', {
      host: process.env.OBS_HOST || 'localhost',
      port: parseInt(process.env.OBS_PORT || '4455', 10),
      password: process.env.OBS_PASSWORD || '',
    });
    if (process.env.OBS_RECORDING_PATH) {
      store.set('settings.obsRecordingPath', process.env.OBS_RECORDING_PATH);
    }
    if (process.env.OPENCLIP_DEST_PATH) {
      store.set('settings.destinationPath', process.env.OPENCLIP_DEST_PATH);
    }
    console.log('[integration] Store seeded with OBS WebSocket settings and paths');
  }

  // Auto-detect OBS recording path on startup in production (non-integration) mode if not set
  if (!isIntegrationMode && !store.get('settings.obsRecordingPath')) {
    const detected = readOBSRecordingPath();
    if (detected) store.set('settings.obsRecordingPath', detected);
  }

  // Start the API server
  apiServer = startApiServer(store);
  apiServer.on('listening', () => {
    appState.apiPort = apiServer.address().port;
    console.log(`API server on port ${appState.apiPort}`);
    apiPortResolve();
  });

  createWindow();
  if (appState.registerHotkey) appState.registerHotkey();

  // In production, run the full auto-updater (checks, downloads, and installs on quit).
  // In dev, wire up events and settings so a manual check triggers a real check+download
  // against GitHub releases, but stops short of installing.
  if (app.isPackaged) {
    setupAutoUpdater(() => appState.mainWindow);
  } else {
    setupDevAutoUpdater(() => appState.mainWindow);
  }

  // Auto-start watcher on startup if configured
  if (store.get('settings.startWatcherOnStartup')) {
    ensureGameState();
    const { runAutoDelete } = require('./recordingService');
    try { runAutoDelete(); } catch {}
    appState.watcherStartedAt = Date.now();
    appState.watcher = setupGameWatcher(store, (state) => {
      appState.currentGame = state.currentGame;
      if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
        appState.mainWindow.webContents.send('watcher:status-push', {
          running: !!appState.watcher,
          currentGame: appState.currentGame,
          startedAt: appState.watcherStartedAt,
          gameState: (() => { try { return fs.readFileSync(STATE_FILE, 'utf-8').trim(); } catch { return null; } })(),
        });
      }
      if (appState.registerHotkey) appState.registerHotkey();
    }, (progress) => {
      try { appState.mainWindow?.webContents.send('session:process-progress', progress); } catch {}
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (appState.watcher) appState.watcher.stop();
  if (apiServer) apiServer.close();
  globalShortcut.unregisterAll();
  const { killAllProcesses } = require('./recordingService');
  killAllProcesses();
  app.quit();
});
