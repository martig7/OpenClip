import { useState, useEffect, useRef } from 'react';
import { FolderOpen, RefreshCw, Copy, Save, Wand2, Download, Package, Trash2, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import api from '../api';
import OnboardingModal from '../components/OnboardingModal';
import { HotkeyCapture } from '../components/OnboardingSteps';

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [toast, setToast] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [pluginInstalled, setPluginInstalled] = useState(null);
  const [pluginBusy, setPluginBusy] = useState(false);
  const [pluginMsg, setPluginMsg] = useState(null); // { ok: bool, text: string }
  const [obsInstallPath, setObsInstallPath] = useState('');

  useEffect(() => {
    loadSettings();
    api.isOBSPluginRegistered().then(setPluginInstalled);
    api.getOBSInstallPath().then(p => setObsInstallPath(p || ''));
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
    const unsubError = api.onUpdateError?.((info) => {
      setUpdateStatus({ type: 'error', message: info?.message });
      setCheckingUpdate(false);
    });
    return () => {
      unsubAvailable?.();
      unsubProgress?.();
      unsubDownloaded?.();
      unsubError?.();
    };
  }, []);

  async function loadSettings() {
    const s = await api.getStore('settings');
    setSettings(s);
    setIsLoading(false);
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

  async function installPlugin() {
    setPluginBusy(true);
    setPluginMsg(null);
    const savedPath = obsInstallPath.trim() || null;
    if (savedPath) await api.setOBSInstallPath(savedPath);
    const result = await api.installOBSPlugin(savedPath);
    if (result?.success) {
      setPluginInstalled(true);
      setPluginMsg({ ok: true, text: 'Plugin installed. Restart OBS to apply.' });
    } else {
      setPluginMsg({ ok: false, text: result?.message || 'Installation failed.' });
    }
    setPluginBusy(false);
  }

  async function removePlugin() {
    setPluginBusy(true);
    setPluginMsg(null);
    const result = await api.removeOBSPlugin();
    if (result?.success) {
      setPluginInstalled(false);
      setPluginMsg({ ok: true, text: 'Plugin removed. Restart OBS to apply.' });
    } else {
      setPluginMsg({ ok: false, text: result?.message || 'Removal failed.' });
    }
    setPluginBusy(false);
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

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
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
            <HotkeyCapture
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

        {/* OBS Plugin */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">OBS Plugin</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 12px' }}>
            The OpenClip native plugin controls recording and scene management inside OBS.
          </p>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">OBS Install Folder</label>
            <div className="form-input-row">
              <input
                className="form-input"
                value={obsInstallPath}
                onChange={e => setObsInstallPath(e.target.value)}
                placeholder="e.g. C:\Program Files\obs-studio"
              />
              <button
                className="btn btn-secondary btn-sm"
                title="Auto-detect"
                onClick={async () => {
                  const p = await api.detectOBSInstallPath();
                  if (p) setObsInstallPath(p);
                }}
              >
                <RefreshCw size={13} />
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const dir = await api.openDirectoryDialog();
                  if (dir) setObsInstallPath(dir);
                }}
              >
                <FolderOpen size={13} />
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={installPlugin}
              disabled={pluginBusy}
            >
              {pluginBusy && !pluginInstalled
                ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
                : <Package size={13} />}
              {pluginInstalled ? 'Reinstall Plugin' : 'Install Plugin'}
            </button>
            {pluginInstalled && (
              <button
                className="btn btn-danger btn-sm"
                onClick={removePlugin}
                disabled={pluginBusy}
              >
                {pluginBusy
                  ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Trash2 size={13} />}
                Remove Plugin
              </button>
            )}
            {pluginMsg && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: pluginMsg.ok ? 'var(--text-muted)' : 'var(--color-error, #e55)' }}>
                {pluginMsg.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                {pluginMsg.text}
              </span>
            )}
            {pluginInstalled === null && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                <Loader size={13} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Checking…
              </span>
            )}
            {pluginInstalled === false && !pluginMsg && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not installed</span>
            )}
            {pluginInstalled === true && !pluginMsg && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-muted)' }}>
                <CheckCircle size={13} /> Installed
              </span>
            )}
          </div>
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
            {updateStatus?.type === 'error' && (
              <span style={{ fontSize: 13, color: 'var(--color-error, #e55)' }}>
                Update failed: {updateStatus.message || 'unknown error'}
              </span>
            )}
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
      <OnboardingModal open={showWizard} onClose={() => { setShowWizard(false); loadSettings(); }} />
    </>
  );
}
