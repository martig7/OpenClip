import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { FolderOpen, RefreshCw, Wifi, QrCode, Clipboard, Copy, Save } from 'lucide-react';
import api from '../api';

const HOTKEY_OPTIONS = [
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'Insert', 'Delete', 'PageUp', 'PageDown',
  'numadd', 'numsub', 'nummult', 'numdiv',
];

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [toast, setToast] = useState(null);
  const [obsScriptPath, setObsScriptPath] = useState('');

  // Keep a ref to pasteQRSettings so the document paste listener always calls
  // the latest version (which closes over the current settings value).
  const pasteQRSettingsRef = useRef(null);

  useEffect(() => {
    loadSettings();
    api.getOBSScriptPath().then(p => setObsScriptPath(p || '')).catch(() => { /* not available in browser dev mode */ });
  }, []);

  useEffect(() => {
    // Add keyboard shortcut for pasting QR code (Ctrl+V or Cmd+V)
    const handlePaste = (e) => {
      // Don't intercept paste if user is typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Synchronous clipboard type check: avoids an async IPC round-trip and
      // allows e.preventDefault() to actually cancel the paste (which requires
      // calling it before the event handler yields to await).
      const hasImage =
        e.clipboardData &&
        [...(e.clipboardData.types || [])].some(t => t.startsWith('image') || t === 'Files');
      if (!hasImage) return;

      e.preventDefault();
      // Delegate to the latest pasteQRSettings via ref so the handler always
      // has access to the current settings state even though the effect only
      // runs once.
      pasteQRSettingsRef.current?.();
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
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

  async function testWSConnection() {
    const result = await api.testOBSWSConnection();
    showToast(result.success ? `Connected: ${result.version}` : `Failed: ${result.message}`);
  }

  async function pasteQRSettings() {
    const result = await api.readOBSWSQRFromClipboard();
    
    if (!result.success) {
      showToast(`Failed: ${result.message}`);
      return;
    }
    
    applyQRSettings(result.settings);
  }
  // Keep the ref up-to-date after every render so the document paste listener
  // (registered once on mount) always calls the latest version of this function.
  useLayoutEffect(() => {
    pasteQRSettingsRef.current = pasteQRSettings;
  });

  async function importQRSettings() {
    const imagePath = await api.openFileDialog({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
    });
    
    if (!imagePath) return;
    
    const result = await api.readOBSWSQR(imagePath);
    
    if (!result.success) {
      showToast(`Failed: ${result.message}`);
      return;
    }
    
    applyQRSettings(result.settings);
  }

  function applyQRSettings(qrSettings) {
    // Update settings with values from QR code
    const { host, port, password } = qrSettings;
    const updated = { ...settings };
    
    if (!updated.obsWebSocket) {
      updated.obsWebSocket = {};
    }
    
    if (host !== undefined) {
      updated.obsWebSocket.host = host;
    }
    if (port !== undefined) {
      updated.obsWebSocket.port = port;
    }
    if (password !== undefined) {
      updated.obsWebSocket.password = password;
    }
    
    setSettings(updated);
    setIsDirty(true);
    showToast(`OBS WebSocket imported: ${host || 'localhost'}:${port || 4455}`);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
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

        {/* OBS Script Setup */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">OBS Script Setup</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 12px' }}>
            This app writes its game state to a file that the OBS Lua script reads to start/stop recording automatically.
            Add the script below to OBS once: <strong>Tools → Scripts → "+"</strong> and select the file.
          </p>
          <div className="form-group">
            <label className="form-label">Lua Script Location</label>
            <div className="form-input-row">
              <input
                className="form-input"
                value={obsScriptPath}
                readOnly
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                placeholder="Loading..."
              />
              <button
                className="btn btn-secondary btn-sm"
                title="Copy path to clipboard"
                onClick={() => {
                  if (obsScriptPath) {
                    navigator.clipboard.writeText(obsScriptPath);
                    showToast('Path copied to clipboard');
                  }
                }}
              >
                <Copy size={13} />
              </button>
              <button
                className="btn btn-secondary btn-sm"
                title="Show in Explorer"
                onClick={() => obsScriptPath && api.showInExplorer(obsScriptPath)}
              >
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
            You can manually enter connection details below, or take a screenshot of the QR code in OBS and paste it here (Ctrl+V).
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

          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={testWSConnection}>
              <Wifi size={13} /> Test Connection
            </button>
            <button className="btn btn-secondary btn-sm" onClick={pasteQRSettings} title="Paste QR code image from clipboard (Ctrl+V)">
              <Clipboard size={13} /> Paste QR Code
            </button>
            <button className="btn btn-secondary btn-sm" onClick={importQRSettings}>
              <QrCode size={13} /> Browse for QR Code
            </button>
          </div>
        </div>

        {/* Clip Marker */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Clip Marker Hotkey</div>
          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Hotkey</label>
            <select
              className="form-input"
              value={settings.clipMarkerHotkey || 'F9'}
              onChange={e => updateSetting('clipMarkerHotkey', e.target.value)}
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
