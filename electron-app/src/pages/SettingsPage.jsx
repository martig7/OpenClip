import { useState, useEffect } from 'react';
import { FolderOpen, RefreshCw, Wifi } from 'lucide-react';
import api from '../api';

const HOTKEY_OPTIONS = [
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Insert', 'Delete', 'PageUp', 'PageDown',
  'numadd', 'numsub', 'nummult', 'numdiv',
];

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const s = await api.getStore('settings');
    setSettings(s);
  }

  async function updateSetting(path, value) {
    const keys = path.split('.');
    const updated = { ...settings };
    let obj = updated;
    for (let i = 0; i < keys.length - 1; i++) {
      obj[keys[i]] = { ...obj[keys[i]] };
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    setSettings(updated);
    await api.setStore('settings', updated);
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

  async function testWSConnection() {
    const result = await api.testOBSWSConnection();
    showToast(result.success ? `Connected: ${result.version}` : `Failed: ${result.message}`);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  if (!settings) return null;

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Configure recording paths, hotkeys, and automation</p>
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

        {/* OBS WebSocket */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">OBS WebSocket</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 12px' }}>
            Connect to OBS via WebSocket to auto-create scenes. Enable WebSocket Server in OBS under Tools → WebSocket Server Settings.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 8 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Host</label>
              <input
                className="form-input"
                value={settings.obsWebSocket?.host || 'localhost'}
                onChange={e => updateSetting('obsWebSocket.host', e.target.value)}
                placeholder="localhost"
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Port</label>
              <input
                type="number"
                className="form-input"
                value={settings.obsWebSocket?.port ?? 4455}
                onChange={e => updateSetting('obsWebSocket.port', parseInt(e.target.value) || 4455)}
                style={{ width: 90 }}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Password (optional)</label>
            <input
              type="password"
              className="form-input"
              value={settings.obsWebSocket?.password || ''}
              onChange={e => updateSetting('obsWebSocket.password', e.target.value)}
              placeholder="Leave blank if no password set"
            />
          </div>

          <button className="btn btn-secondary btn-sm" onClick={testWSConnection} style={{ marginTop: 4 }}>
            <Wifi size={13} /> Test Connection
          </button>
        </div>

        {/* Clip Marker */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Clip Marker Hotkey</div>
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Hotkey</label>
            <select
              className="form-input"
              value={settings.clipMarkerHotkey || 'F9'}
              onChange={e => {
                updateSetting('clipMarkerHotkey', e.target.value);
                api.registerHotkey();
              }}
              style={{ width: 160 }}
            >
              {HOTKEY_OPTIONS.map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
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
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
