/**
 * Registers all IPC handlers for the Electron main process.
 * Call registerIpcHandlers(store, appState) after the store is initialized.
 *
 * appState is a mutable object shared with main.js:
 *   { watcher, watcherStartedAt, currentGame, mainWindow, apiPort, apiPortReady }
 */
const { ipcMain, dialog, shell, globalShortcut, app } = require('electron');
const path = require('path');
const fs = require('fs');

const { setupGameWatcher } = require('./gameWatcher');
const { setupFileManager } = require('./fileManager');
const { readOBSRecordingPath } = require('./obsIntegration');
const { getProfiles, readEncodingSettings, writeEncodingSettings, isOBSRunning, findOBSExecutable } = require('./obsEncoding');
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
const { setupAutoUpdater, setupDevAutoUpdater, registerUpdateHandlers } = require('./autoUpdater');
const { RUNTIME_DIR, STATE_FILE, ICONS_DIR, PLUGIN_DLL_NAME } = require('./constants');

// Concurrency guard: limit simultaneous PowerShell spawns to avoid thundering-herd
const PS_MAX_CONCURRENT = 3;
let _psActive = 0;
const _psQueue = [];
function runWithPsLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      _psActive++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        _psActive--;
        if (_psQueue.length) _psQueue.shift()();
      });
    };
    if (_psActive < PS_MAX_CONCURRENT) run();
    else _psQueue.push(run);
  });
}

// Short-lived caches for expensive PowerShell queries.
const _windowsListCache = { data: null, ts: 0, inflight: null };
const _audioDevicesCache = { data: null, ts: 0, inflight: null };
const _runningAppsCache  = { data: null, ts: 0, inflight: null };

const { runElevated } = require('./runElevated');

function registerIpcHandlers(store, appState) {
  // appState: { watcher, watcherStartedAt, currentGame, mainWindow, apiPort, apiPortReady }

  function pushWatcherStatus() {
    if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
      const gameState = readGameState();
      appState.mainWindow.webContents.send('watcher:status-push', {
        running: !!appState.watcher,
        currentGame: appState.currentGame,
        startedAt: appState.watcherStartedAt,
        gameState,
      });
    }
  }

  function readGameState() {
    try {
      return fs.readFileSync(STATE_FILE, 'utf-8').trim();
    } catch {
      return null;
    }
  }

  function registerHotkey() {
    globalShortcut.unregisterAll();
    const hotkey = store.get('settings.clipMarkerHotkey');
    if (hotkey && appState.currentGame) {
      globalShortcut.register(hotkey, () => {
        const markers = store.get('clipMarkers') || [];
        markers.push({
          game: appState.currentGame,
          timestamp: Date.now() / 1000,
          created: new Date().toISOString(),
        });
        store.set('clipMarkers', markers);
        if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
          appState.mainWindow.webContents.send('clip:marker-added', markers.length);
        }
      });
    }
  }

  // Make registerHotkey accessible to main.js via appState
  appState.registerHotkey = registerHotkey;

  // --- Settings ---
  ipcMain.handle('store:get', (_event, key) => store.get(key));
  ipcMain.handle('store:set', (_event, key, value) => store.set(key, value));

  // --- Games ---
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

  // --- Windows ---
  ipcMain.handle('windows:list', async () => {
    const now = Date.now();
    if (_windowsListCache.data !== null && now - _windowsListCache.ts < 5000) return _windowsListCache.data;
    if (_windowsListCache.inflight) return _windowsListCache.inflight;

    _windowsListCache.inflight = runWithPsLimit(() => {
      const { exec } = require('child_process');
      return new Promise((resolve) => {
        const cmd = `powershell -NoProfile -Command `
          + `"Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public class Win32 { [DllImport(\\"user32.dll\\")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId); [DllImport(\\"user32.dll\\", SetLastError = true, CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount); }'; `
          + `Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and $_.MainWindowHandle -ne 0 } | Select-Object ProcessName, MainWindowTitle, `
          + `@{Name='Executable';Expression={ try { $_.MainModule.FileName } catch { $_.Path } }}, `
          + `@{Name='Class';Expression={ $sb = New-Object System.Text.StringBuilder(256); [Win32]::GetClassName($_.MainWindowHandle, $sb, $sb.Capacity) | Out-Null; $sb.ToString() }} | ConvertTo-Json"`;

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
                exe: p.Executable ? require('path').basename(p.Executable) : `${p.ProcessName}.exe`,
                windowClass: p.Class || p.ProcessName,
              }))
            );
          } catch {
            resolve([]);
          }
        });
      });
    }).then((result) => {
      _windowsListCache.data = result;
      _windowsListCache.ts = Date.now();
      _windowsListCache.inflight = null;
      return result;
    });

    return _windowsListCache.inflight;
  });

  ipcMain.handle('windows:list-audio-devices', async () => {
    const now = Date.now();
    if (_audioDevicesCache.data !== null && now - _audioDevicesCache.ts < 10000) return _audioDevicesCache.data;
    if (_audioDevicesCache.inflight) return _audioDevicesCache.inflight;

    _audioDevicesCache.inflight = runWithPsLimit(() => {
      const { exec } = require('child_process');
      const cmd = `powershell -NoProfile -Command "
    try {
      $devices = @();
      Get-WmiObject Win32_SoundDevice | ForEach-Object {
        $devices += [PSCustomObject]@{ name=$_.Name; type='output'; id=$_.DeviceID }
      };
      Get-WmiObject Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'AudioEndpoint' -and $_.Name -match 'Microphone|mic|input' } | ForEach-Object {
        $devices += [PSCustomObject]@{ name=$_.Name; type='input'; id=$_.DeviceID }
      };
      $devices | ConvertTo-Json -Compress
    } catch { '[]' }
  "`;
      return new Promise((resolve) => {
        exec(cmd, { encoding: 'utf-8', timeout: 8000 }, (error, stdout) => {
          if (error) return resolve([]);
          try {
            const raw = stdout.trim();
            if (!raw || raw === '[]') return resolve([]);
            const parsed = JSON.parse(raw);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            resolve(items
              .filter(d => d && d.name)
              .map(d => ({ name: d.name, type: d.type || 'output', id: d.id || d.name }))
            );
          } catch {
            resolve([]);
          }
        });
      });
    }).then((result) => {
      _audioDevicesCache.data = result;
      _audioDevicesCache.ts = Date.now();
      _audioDevicesCache.inflight = null;
      return result;
    });

    return _audioDevicesCache.inflight;
  });

  ipcMain.handle('windows:list-running-apps', async () => {
    const now = Date.now();
    if (_runningAppsCache.data !== null && now - _runningAppsCache.ts < 5000) return _runningAppsCache.data;
    if (_runningAppsCache.inflight) return _runningAppsCache.inflight;

    _runningAppsCache.inflight = runWithPsLimit(() => {
      const { exec } = require('child_process');
      const skipList = ['svchost','conhost','csrss','dwm','smss','lsass','wininit','services','Registry','Idle','System','audiodg','RuntimeBroker','SearchHost','TextInputHost','ShellExperienceHost','ApplicationFrameHost','StartMenuExperienceHost','SystemSettings','taskhostw','sihost','fontdrvhost','NisSrv','MsMpEng'];
      const skipStr = skipList.map(s => `'${s}'`).join(',');
      const cmd = `powershell -NoProfile -Command "$skip = @(${skipStr}); Get-Process | Where-Object { $skip -notcontains $_.Name -and $_.Id -ne $PID } | Select-Object -Unique Name, @{N='HasWindow';E={$_.MainWindowTitle -ne ''}} | ConvertTo-Json -Compress"`;
      return new Promise((resolve) => {
        exec(cmd, { encoding: 'utf-8', timeout: 8000 }, (error, stdout) => {
          if (error) return resolve([]);
          try {
            const raw = stdout.trim();
            if (!raw || raw === '[]' || raw === 'null') return resolve([]);
            const parsed = JSON.parse(raw);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            const seen = new Map();
            for (const p of items) {
              if (!p || !p.Name) continue;
              if (!seen.has(p.Name) || p.HasWindow) {
                seen.set(p.Name, { name: p.Name, exe: `${p.Name}.exe`, hasWindow: !!p.HasWindow });
              }
            }
            resolve([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
          } catch {
            resolve([]);
          }
        });
      });
    }).then((result) => {
      _runningAppsCache.data = result;
      _runningAppsCache.ts = Date.now();
      _runningAppsCache.inflight = null;
      return result;
    });

    return _runningAppsCache.inflight;
  });

  // --- Dialogs ---
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(appState.mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('dialog:openFile', async (_event, opts = {}) => {
    const result = await dialog.showOpenDialog(appState.mainWindow, { properties: ['openFile'], ...opts });
    return result.canceled ? null : result.filePaths[0];
  });

  // --- File operations ---
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

  // --- Recordings & Clips (delegated to fileManager) ---
  setupFileManager(ipcMain, store);

  // --- Clip marker hotkey ---
  ipcMain.handle('hotkey:register', () => {
    registerHotkey();
    return true;
  });

  // --- Watcher ---
  ipcMain.handle('watcher:start', () => {
    if (appState.watcher) return { running: true };
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8');

    const { runAutoDelete } = require('./recordingService');
    try { runAutoDelete(); } catch {}

    appState.watcherStartedAt = Date.now();
    appState.watcher = setupGameWatcher(store, (state) => {
      appState.currentGame = state.currentGame;
      pushWatcherStatus();
      registerHotkey();
    }, (progress) => {
      try { appState.mainWindow?.webContents.send('session:process-progress', progress); } catch {}
    });
    pushWatcherStatus();
    return { running: true };
  });
  ipcMain.handle('watcher:stop', () => {
    if (appState.watcher) {
      appState.watcher.stop();
      appState.watcher = null;
      appState.watcherStartedAt = null;
      appState.currentGame = null;
      try { fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8'); } catch {}
    }
    pushWatcherStatus();
    return { running: false };
  });
  ipcMain.handle('watcher:status', () => {
    const gameState = readGameState();
    return {
      running: !!appState.watcher,
      currentGame: appState.currentGame,
      startedAt: appState.watcherStartedAt,
      gameState,
    };
  });

  // --- OBS ---
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

  // OBS Plugin / WebSocket
  ipcMain.handle('obs:ws:script-loaded', async () => {
    try { return await isPluginReachable(); } catch { return false; }
  });
  ipcMain.handle('obs:ws:scenes', async () => {
    try {
      return await getOBSScenes();
    } catch (err) {
      console.error('[main] obs:ws:scenes error:', err.message);
      throw err;
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
      throw err;
    }
  });
  ipcMain.handle('obs:ws:get-input-audio-tracks', async (_e, inputName) => {
    try {
      return await getInputAudioTracks(undefined, inputName);
    } catch {
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

  // --- API port ---
  ipcMain.handle('api:port', async () => {
    await appState.apiPortReady;
    return appState.apiPort;
  });

  // --- Onboarding ---
  ipcMain.handle('onboarding:isComplete', () => {
    return store._electron().onboardingComplete === true;
  });
  ipcMain.handle('onboarding:setComplete', (_event, value) => {
    store._electron().onboardingComplete = !!value;
    store._saveElectron();
  });

  // --- OBS installation detection ---
  ipcMain.handle('obs:detect-install', async () => {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const candidates = [
      path.join(process.env.ProgramFiles  || 'C:\\Program Files',       'obs-studio'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'obs-studio'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'obs-studio'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, 'bin', '64bit', 'obs64.exe'))) return dir;
    }
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

  ipcMain.handle('obs:set-install-path', (_event, installPath) => {
    store._electron().obsInstallPath = installPath || '';
    store._saveElectron();
  });
  ipcMain.handle('obs:get-install-path', () => {
    return store._electron().obsInstallPath || '';
  });

  // --- OBS plugin install/remove ---
  ipcMain.handle('obs:install-plugin', async (_event, obsInstallPath) => {
    try {
      if (!obsInstallPath || !path.isAbsolute(obsInstallPath)) {
        return { success: false, message: 'OBS install folder is required. Set it in Settings before installing.' };
      }

      if (await isOBSRunning()) {
        return { success: false, message: 'OBS is currently open. Please close OBS before installing the plugin.' };
      }

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
        const esc = p => p.replace(/'/g, "''");
        const elevResult = runElevated([
          `New-Item -ItemType Directory -Force -Path '${esc(sysPluginDir)}' | Out-Null`,
          `Copy-Item -Path '${esc(dllSrc)}' -Destination '${esc(sysDest)}' -Force`,
          `New-Item -ItemType Directory -Force -Path '${esc(sysLocaleDir)}' | Out-Null`,
          `if (-not (Test-Path '${esc(sysLocale)}')) { New-Item -ItemType File -Path '${esc(sysLocale)}' | Out-Null }`,
        ]);
        if (!elevResult.success) return elevResult;
        console.log(`[main] Plugin installed (system, elevated) to ${sysDest}`);
      }

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

  ipcMain.handle('obs:remove-plugin', async () => {
    try {
      if (await isOBSRunning()) {
        return { success: false, message: 'OBS is currently open. Please close OBS before removing the plugin.' };
      }

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
            const esc = p => p.replace(/'/g, "''");
            const removeResult = runElevated([
              `Remove-Item -Path '${esc(sysDest)}' -Force -ErrorAction SilentlyContinue`,
              `Remove-Item -Path '${esc(sysLocale)}' -Recurse -Force -ErrorAction SilentlyContinue`,
            ]);
            if (!removeResult.success) {
              console.error('[main] Elevated removal failed:', removeResult.message);
              return { success: false, message: removeResult.message || 'Elevated removal failed' };
            }
          }
        }
      }

      const userBase = path.join(app.getPath('appData'), 'obs-studio', 'plugins', 'openclip-obs');
      if (fs.existsSync(userBase)) {
        fs.rmSync(userBase, { recursive: true, force: true });
        console.log(`[main] Removed user plugin folder: ${userBase}`);
      }

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

  // --- Manual organize ---
  ipcMain.handle('recordings:organize', async (event, { filePath, gameName, remux }) => {
    const { organizeSpecificRecording } = require('./fileManager');
    const moveOnly = remux === undefined
      ? store.get('settings.organizeRemux') === false
      : remux === false;
    const onProgress = (stage, label) => {
      try { event.sender.send('recordings:organize-progress', { stage, label }); } catch {}
    };
    return organizeSpecificRecording(store, filePath, gameName, { moveOnly, onProgress });
  });

  // --- Auto-updater IPC handlers ---
  registerUpdateHandlers(ipcMain, () => appState.mainWindow);
}

module.exports = { registerIpcHandlers };
