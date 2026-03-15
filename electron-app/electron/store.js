/**
 * Unified config store backed by the Python JSON files in AppData.
 * Must be required AFTER app.setPath('userData', ...) is called in main.js.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const { GAMES_CONFIG_FILE, MANAGER_SETTINGS_FILE, MARKERS_FILE } = require('./constants');

// Electron-only config (window bounds, OBS recording path, etc.)
const electronConfigPath = path.join(app.getPath('userData'), 'electron.json');
const electronConfigDefaults = {
  windowBounds: { width: 1200, height: 800 },
  obsRecordingPath: '',
  listView: true,
  onboardingComplete: false,
  obsInstallPath: '',
};

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

module.exports = { store, readJson, writeJson };
