/**
 * In-memory test store for E2E testing.
 * Mimics the API of store.js but stores everything in memory.
 */
const electronConfigDefaults = {
  windowBounds: { width: 1200, height: 800 },
  obsRecordingPath: '',
  listView: true,
  onboardingComplete: false,
  obsInstallPath: '',
};

const gamesConfigDefaults = { games: [] };
const managerSettingsDefaults = {
  organized_path: '',
  auto_organize: true,
  start_watcher_on_startup: false,
  storage_settings: {
    auto_delete_enabled: false,
    max_storage_gb: 100,
    max_age_days: 30,
    exclude_clips: true,
  },
  locked_recordings: [],
  clip_hotkey: 'F9',
  auto_clip_settings: {
    enabled: false,
    buffer_before_seconds: 15,
    buffer_after_seconds: 15,
    remove_processed_markers: true,
    delete_recording_after_clips: false,
  },
  obs_websocket: { host: 'localhost', port: 4455, password: '' },
};

function msToElectronSettings(ms, obsRecordingPath, electronData) {
  return {
    obsRecordingPath: obsRecordingPath || '',
    destinationPath: ms.organized_path || '',
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

function electronSettingsToMs(ms, electronSettings) {
  const updated = { ...ms };
  if (electronSettings.destinationPath !== undefined) {
    updated.organized_path = electronSettings.destinationPath;
  }
  if (electronSettings.startWatcherOnStartup !== undefined) {
    updated.start_watcher_on_startup = electronSettings.startWatcherOnStartup;
  }
  if (electronSettings.clipMarkerHotkey !== undefined) {
    updated.clip_hotkey = electronSettings.clipMarkerHotkey;
  }
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

const store = {
  _gamesData: JSON.parse(JSON.stringify(gamesConfigDefaults)),
  _msData: JSON.parse(JSON.stringify(managerSettingsDefaults)),
  _electronData: JSON.parse(JSON.stringify(electronConfigDefaults)),
  _clipMarkers: [],

  _electron() {
    return this._electronData;
  },

  _saveElectron() {},

  get(key) {
    if (!key) return null;

    if (key === 'games') {
      return this._gamesData.games || [];
    }
    if (key === 'windowBounds') {
      return this._electronData.windowBounds || electronConfigDefaults.windowBounds;
    }
    if (key === 'masterAudioSources') {
      return this._electronData.masterAudioSources || [];
    }
    if (key === 'audioTracks') {
      return this._electronData.audioTracks || {};
    }
    if (key === 'clipMarkers') {
      return this._clipMarkers;
    }
    if (key === 'lockedRecordings') {
      return this._msData.locked_recordings || [];
    }
    if (key === 'storageSettings') {
      return this._msData.storage_settings || {};
    }

    if (key === 'settings') {
      return msToElectronSettings(
        this._msData,
        this._electronData.obsRecordingPath,
        this._electronData
      );
    }

    if (key.startsWith('settings.')) {
      const subKey = key.slice('settings.'.length);
      const settings = msToElectronSettings(
        this._msData,
        this._electronData.obsRecordingPath,
        this._electronData
      );
      const parts = subKey.split('.');
      let val = settings;
      for (const p of parts) {
        val = val?.[p];
      }
      return val;
    }

    return undefined;
  },

  set(key, value) {
    if (key === 'games') {
      this._gamesData.games = value;
      return;
    }
    if (key === 'windowBounds') {
      this._electronData.windowBounds = value;
      return;
    }
    if (key === 'masterAudioSources') {
      this._electronData.masterAudioSources = value;
      return;
    }
    if (key === 'audioTracks') {
      this._electronData.audioTracks = value;
      return;
    }
    if (key === 'clipMarkers') {
      this._clipMarkers = value;
      return;
    }
    if (key === 'lockedRecordings') {
      this._msData.locked_recordings = value;
      return;
    }
    if (key === 'storageSettings') {
      this._msData.storage_settings = value;
      return;
    }
    if (key === 'settings') {
      if (value.obsRecordingPath !== undefined) {
        this._electronData.obsRecordingPath = value.obsRecordingPath;
      }
      if (value.listView !== undefined) {
        this._electronData.listView = value.listView;
      }
      this._msData = electronSettingsToMs(this._msData, value);
      return;
    }
    if (key.startsWith('settings.')) {
      const subKey = key.slice('settings.'.length);
      if (subKey === 'obsRecordingPath') {
        this._electronData.obsRecordingPath = value;
        return;
      }
      if (subKey === 'listView') {
        this._electronData.listView = value;
        return;
      }
      const current = msToElectronSettings(
        this._msData,
        this._electronData.obsRecordingPath,
        this._electronData
      );
      const parts = subKey.split('.');
      let obj = current;
      for (let i = 0; i < parts.length - 1; i++) {
        obj[parts[i]] = obj[parts[i]] || {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
      this._msData = electronSettingsToMs(this._msData, current);
      return;
    }
  },

  reset() {
    this._gamesData = JSON.parse(JSON.stringify(gamesConfigDefaults));
    this._msData = JSON.parse(JSON.stringify(managerSettingsDefaults));
    this._electronData = JSON.parse(JSON.stringify(electronConfigDefaults));
    this._clipMarkers = [];
  },
};

module.exports = { store };
