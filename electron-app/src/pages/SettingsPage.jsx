import { useState, useEffect, useRef } from 'react';
import { FolderOpen, RefreshCw, Copy, Save, Wand2, Download } from 'lucide-react';
import api from '../api';
import OnboardingModal from '../components/OnboardingModal';

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS']);

const NUMPAD_MAP = {
  Numpad0: 'num0', Numpad1: 'num1', Numpad2: 'num2', Numpad3: 'num3',
  Numpad4: 'num4', Numpad5: 'num5', Numpad6: 'num6', Numpad7: 'num7',
  Numpad8: 'num8', Numpad9: 'num9', NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', NumpadEnter: 'Return',
};

const SPECIAL_KEYS = {
  ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down',
  ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return',
};

function buildAccelerator(e, useModifiers) {
  let key;
  if (e.code.startsWith('Numpad')) {
    key = NUMPAD_MAP[e.code];
  } else {
    key = SPECIAL_KEYS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  }
  if (!key) return null;

  const parts = [];
  if (useModifiers) {
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
  }
  parts.push(key);
  return parts.join('+');
}

function HotkeyInput({ value, onChange }) {
  const [listening, setListening] = useState(false);
  const [useModifiers, setUseModifiers] = useState(() => (value || '').includes('+'));
  const containerRef = useRef(null);

  // Sync modifier toggle when value changes from outside (e.g. on load)
  useEffect(() => {
    if (!listening) setUseModifiers((value || '').includes('+'));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!listening) return;

    const handleKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_KEYS.has(e.key)) return;
      // Escape with no modifiers cancels
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setListening(false);
        return;
      }
      const accelerator = buildAccelerator(e, useModifiers);
      if (accelerator) {
        onChange(accelerator);
        setListening(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [listening, useModifiers, onChange]);

  // Click outside cancels
  useEffect(() => {
    if (!listening) return;
    const handlePointerDown = (e) => {
      if (!containerRef.current?.contains(e.target)) setListening(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [listening]);

  return (
    <div ref={containerRef} className="hotkey-input-wrap">
      <button
        type="button"
        className={`hotkey-capture-btn${listening ? ' listening' : ''}`}
        onClick={() => setListening(l => !l)}
      >
        {listening ? 'Press a key…' : (value || 'Click to set')}
      </button>
      <div className="toggle-row" style={{ paddingTop: 10, borderTop: 'none' }}>
        <div>
          <div className="toggle-label" style={{ fontSize: 12 }}>Include modifier keys</div>
          <div className="toggle-desc">Allow Ctrl, Alt, Shift combined with the hotkey</div>
        </div>
        <button
          type="button"
          className={`toggle ${useModifiers ? 'on' : ''}`}
          onClick={() => setUseModifiers(m => !m)}
        />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [toast, setToast] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const unsubAvailable = api.onUpdateAvailable?.((info) => {
      setUpdateStatus({ type: 'available', version: info.version });
      setCheckingUpdate(false);
    });
    const unsubProgress = api.onUpdateProgress?.((progress) => {
      setUpdateStatus({ type: 'progress', percent: progress.percent });
    });
    const unsubDownloaded = api.onUpdateDownloaded?.(() => {
      setUpdateStatus({ type: 'downloaded' });
      setCheckingUpdate(false);
    });
    return () => {
      unsubAvailable?.();
      unsubProgress?.();
      unsubDownloaded?.();
    };
  }, []);

  async function loadSettings() {
    const s = await api.getStore('settings');
    setSettings(s);
  }

  function updateSetting(path, value) {
    const keys = path.split('.');
    const updated = { ...settings };
    let obj = updated;
    for (let i = 0; i < keys.length - 1; i++) {
      obj[keys[i]] = { ...obj[keys[i]] };
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    setSettings(updated);
    setIsDirty(true);
  }

  async function saveSettings() {
    await api.setStore('settings', settings);
    await api.registerHotkey();
    setIsDirty(false);
    showToast('Settings saved');
  }

  async function detectOBSPath() {
    const path = await api.detectOBSPath();
    if (path) {
      updateSetting('obsRecordingPath', path);
      showToast(`Detected OBS path: ${path}`);
    } else {
      showToast('Could not detect OBS recording path');
    }
  }

  async function browseDirectory(settingKey) {
    const dir = await api.openDirectoryDialog();
    if (dir) updateSetting(settingKey, dir);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function checkForUpdate() {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    await api.checkForUpdate?.();
    // If no update is available, electron-updater fires no event, so clear the spinner after a reasonable timeout.
    const UPDATE_CHECK_TIMEOUT_MS = 10000;
    setTimeout(() => setCheckingUpdate(false), UPDATE_CHECK_TIMEOUT_MS);
  }

  async function installUpdate() {
    await api.installUpdate?.();
  }

  if (!settings) return null;

  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1>Settings</h1>
          <p>Configure recording paths, hotkeys, and automation</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 2 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowWizard(true)}
          >
            <Wand2 size={13} /> Setup Wizard
          </button>
          {isDirty && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Unsaved changes</span>
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={saveSettings}
            disabled={!isDirty}
            style={{ opacity: isDirty ? 1 : 0.4 }}
          >
            <Save size={13} /> Save Settings
          </button>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 640 }}>
        {/* Paths */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Recording Paths</div>

          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">OBS Recording Folder</label>
            <div className="form-input-row">
              <input
                className="form-input"
                value={settings.obsRecordingPath || ''}
                onChange={e => updateSetting('obsRecordingPath', e.target.value)}
                placeholder="Path to OBS recordings"
              />
              <button className="btn btn-secondary btn-sm" onClick={detectOBSPath} title="Auto-detect">
                <RefreshCw size={13} />
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => browseDirectory('obsRecordingPath')}>
                <FolderOpen size={13} />
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Organized Recordings Destination</label>
            <div className="form-input-row">
              <input
                className="form-input"
                value={settings.destinationPath || ''}
                onChange={e => updateSetting('destinationPath', e.target.value)}
                placeholder="Where to organize recordings"
              />
              <button className="btn btn-secondary btn-sm" onClick={() => browseDirectory('destinationPath')}>
                <FolderOpen size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Watcher */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Watcher</div>

          <div className="toggle-row" style={{ marginTop: 8 }}>
            <div>
              <div className="toggle-label">Start Watcher on Startup</div>
              <div className="toggle-desc">Automatically start the game watcher when the app launches</div>
            </div>
            <button
              className={`toggle ${settings.startWatcherOnStartup ? 'on' : ''}`}
              onClick={() => updateSetting('startWatcherOnStartup', !settings.startWatcherOnStartup)}
            />
          </div>
        </div>

        {/* View */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">View</div>

          <div className="form-group" style={{ marginTop: 8 }}>
            <label className="form-label">Storage View</label>
            <div className="toggle-desc" style={{ marginBottom: 6 }}>Choose how recordings and clips are displayed</div>
            <select
              className="form-input"
              value={settings.listView !== false ? 'list' : 'grid'}
              onChange={e => updateSetting('listView', e.target.value === 'list')}
            >
              <option value="list">List</option>
              <option value="grid">Grid</option>
            </select>
          </div>
        </div>

        {/* Clip Marker */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Clip Marker Hotkey</div>
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Hotkey</label>
            <HotkeyInput
              value={settings.clipMarkerHotkey || 'F9'}
              onChange={v => updateSetting('clipMarkerHotkey', v)}
            />
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              Press this key while gaming to mark a moment for clipping
            </span>
          </div>
        </div>

        {/* Auto-Clip */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Auto-Clip</div>

          <div className="toggle-row" style={{ marginTop: 8 }}>
            <div>
              <div className="toggle-label">Enable Auto-Clip</div>
              <div className="toggle-desc">Automatically create clips from markers when recording ends</div>
            </div>
            <button
              className={`toggle ${settings.autoClip?.enabled ? 'on' : ''}`}
              onClick={() => updateSetting('autoClip.enabled', !settings.autoClip?.enabled)}
            />
          </div>

          {settings.autoClip?.enabled && (
            <>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label">Buffer Before Marker (seconds)</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.autoClip?.bufferBefore ?? 15}
                  onChange={e => updateSetting('autoClip.bufferBefore', parseInt(e.target.value) || 0)}
                  style={{ width: 100 }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Buffer After Marker (seconds)</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.autoClip?.bufferAfter ?? 15}
                  onChange={e => updateSetting('autoClip.bufferAfter', parseInt(e.target.value) || 0)}
                  style={{ width: 100 }}
                />
              </div>

              <div className="toggle-row">
                <div>
                  <div className="toggle-label">Remove Markers After Clipping</div>
                </div>
                <button
                  className={`toggle ${settings.autoClip?.removeMarkers ? 'on' : ''}`}
                  onClick={() => updateSetting('autoClip.removeMarkers', !settings.autoClip?.removeMarkers)}
                />
              </div>

              <div className="toggle-row">
                <div>
                  <div className="toggle-label">Delete Full Recording</div>
                  <div className="toggle-desc">Only keep the clips, delete the original recording</div>
                </div>
                <button
                  className={`toggle ${settings.autoClip?.deleteFullRecording ? 'on' : ''}`}
                  onClick={() => updateSetting('autoClip.deleteFullRecording', !settings.autoClip?.deleteFullRecording)}
                />
              </div>
            </>
          )}
        </div>

        {/* Auto-Delete */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Storage Management</div>

          <div className="toggle-row" style={{ marginTop: 8 }}>
            <div>
              <div className="toggle-label">Auto-Delete Old Recordings</div>
              <div className="toggle-desc">Automatically clean up old recordings on watcher startup</div>
            </div>
            <button
              className={`toggle ${settings.autoDelete?.enabled ? 'on' : ''}`}
              onClick={() => updateSetting('autoDelete.enabled', !settings.autoDelete?.enabled)}
            />
          </div>

          {settings.autoDelete?.enabled && (
            <>
              <div className="form-group" style={{ marginTop: 12 }}>
                <label className="form-label">Max Storage (GB)</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.autoDelete?.maxStorageGB ?? 50}
                  onChange={e => updateSetting('autoDelete.maxStorageGB', parseInt(e.target.value) || 0)}
                  style={{ width: 100 }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Max Age (days)</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.autoDelete?.maxAgeDays ?? 30}
                  onChange={e => updateSetting('autoDelete.maxAgeDays', parseInt(e.target.value) || 0)}
                  style={{ width: 100 }}
                />
              </div>

              <div className="toggle-row">
                <div>
                  <div className="toggle-label">Exclude Clips from Auto-Delete</div>
                </div>
                <button
                  className={`toggle ${settings.autoDelete?.excludeClips ? 'on' : ''}`}
                  onClick={() => updateSetting('autoDelete.excludeClips', !settings.autoDelete?.excludeClips)}
                />
              </div>
            </>
          )}
        </div>

        {/* Updates */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Updates</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={checkForUpdate}
              disabled={checkingUpdate || updateStatus?.type === 'downloaded'}
            >
              <RefreshCw size={13} style={{ animation: checkingUpdate ? 'spin 1s linear infinite' : 'none' }} />
              {checkingUpdate ? 'Checking…' : 'Check for Updates'}
            </button>
            {updateStatus?.type === 'available' && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Version {updateStatus.version} available — downloading…
              </span>
            )}
            {updateStatus?.type === 'progress' && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Downloading… {Math.round(updateStatus.percent)}%
              </span>
            )}
            {updateStatus?.type === 'downloaded' && (
              <button className="btn btn-primary btn-sm" onClick={installUpdate}>
                <Download size={13} /> Install &amp; Restart
              </button>
            )}
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
      <OnboardingModal open={showWizard} onClose={() => { setShowWizard(false); loadSettings(); }} />
    </>
  );
}
