import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, ChevronRight, ChevronLeft, FolderOpen, RefreshCw, Wifi,
  Download, CheckCircle, AlertCircle, Loader, Keyboard, Copy, QrCode, Clipboard,
  HardDrive, Scissors, Play, ExternalLink, Package, Monitor,
} from 'lucide-react';
import api from '../api';

/* ── Small helpers ── */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS']);
const NUMPAD_MAP = {
  Numpad0:'num0', Numpad1:'num1', Numpad2:'num2', Numpad3:'num3',
  Numpad4:'num4', Numpad5:'num5', Numpad6:'num6', Numpad7:'num7',
  Numpad8:'num8', Numpad9:'num9', NumpadAdd:'numadd',
  NumpadSubtract:'numsub', NumpadMultiply:'nummult',
  NumpadDivide:'numdiv', NumpadDecimal:'numdec', NumpadEnter:'Return',
};
const SPECIAL_KEYS = {
  ' ':'Space', ArrowUp:'Up', ArrowDown:'Down',
  ArrowLeft:'Left', ArrowRight:'Right', Enter:'Return',
};
function buildAccelerator(e, useModifiers) {
  let key;
  if (e.code.startsWith('Numpad')) key = NUMPAD_MAP[e.code];
  else key = SPECIAL_KEYS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (!key) return null;
  const parts = [];
  if (useModifiers) {
    if (e.ctrlKey)  parts.push('Ctrl');
    if (e.altKey)   parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey)  parts.push('Meta');
  }
  parts.push(key);
  return parts.join('+');
}

function HotkeyCapture({ value, onChange }) {
  const [listening, setListening] = useState(false);
  const [useMods, setUseMods] = useState(() => (value || '').includes('+'));
  const ref = useRef(null);

  useEffect(() => { if (!listening) setUseMods((value || '').includes('+')); }, [value]); // eslint-disable-line

  useEffect(() => {
    if (!listening) return;
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (MODIFIER_KEYS.has(e.key)) return;
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setListening(false); return;
      }
      const acc = buildAccelerator(e, useMods);
      if (acc) { onChange(acc); setListening(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, useMods, onChange]);

  useEffect(() => {
    if (!listening) return;
    const onPointer = (e) => { if (!ref.current?.contains(e.target)) setListening(false); };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [listening]);

  return (
    <div ref={ref} className="hotkey-input-wrap">
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
        <button type="button" className={`toggle ${useMods ? 'on' : ''}`} onClick={() => setUseMods(m => !m)} />
      </div>
    </div>
  );
}

/* ── Status chip ── */
function Status({ state, message }) {
  if (!state) return null;
  const icon = state === 'checking'
    ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
    : state === 'success' ? <CheckCircle size={12} /> : <AlertCircle size={12} />;
  return <div className={`onboarding-status ${state}`}>{icon}{message}</div>;
}

/* ══════════════════════════════════════════════════════════
   STEP COMPONENTS
══════════════════════════════════════════════════════════ */

/** Step 0 – Welcome */
function StepWelcome() {
  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><Package size={24} /></div>
      <h3>Welcome to OpenClip!</h3>
      <p>
        Let's get you set up in just a few steps. We'll connect to OBS, configure the
        plugin, and tweak the settings that matter most — so you're ready to start
        capturing clips right away.
      </p>
      <p style={{ marginBottom: 0 }}>Click <strong>Next</strong> to begin.</p>
    </div>
  );
}

/** Step 1 – OBS Recording Folder */
function StepOBSPath({ settings, onChange }) {
  const [detecting, setDetecting] = useState(false);

  async function autoDetect() {
    setDetecting(true);
    const p = await api.detectOBSPath().catch(() => null);
    if (p) onChange('obsRecordingPath', p);
    setDetecting(false);
  }

  async function browse() {
    const dir = await api.openDirectoryDialog();
    if (dir) onChange('obsRecordingPath', dir);
  }

  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><FolderOpen size={24} /></div>
      <h3>OBS Recording Folder</h3>
      <p className="onboarding-step-desc">
        Tell OpenClip where OBS saves your recordings. We'll auto-detect it from
        your OBS profile, or you can browse manually.
      </p>

      <div className="form-group">
        <label className="form-label">Recording Folder</label>
        <div className="form-input-row">
          <input
            className="form-input"
            value={settings.obsRecordingPath || ''}
            onChange={e => onChange('obsRecordingPath', e.target.value)}
            placeholder="e.g. C:\Users\You\Videos\OBS"
          />
          <button className="btn btn-secondary btn-sm" onClick={autoDetect} disabled={detecting} title="Auto-detect">
            <RefreshCw size={13} style={detecting ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>
          <button className="btn btn-secondary btn-sm" onClick={browse}>
            <FolderOpen size={13} />
          </button>
        </div>
      </div>

      <button
        className="onboarding-obs-link"
        onClick={() => api.openExternal('https://obsproject.com/download')}
      >
        <ExternalLink size={11} /> Don't have OBS? Install it here
      </button>
    </div>
  );
}

/** Step 2 – OBS Install Location */
function StepOBSInstall({ obsInstallPath, onChangeInstallPath }) {
  const [detecting, setDetecting] = useState(false);

  async function autoDetect() {
    setDetecting(true);
    const p = await api.detectOBSInstallPath?.().catch(() => null);
    if (p) onChangeInstallPath(p);
    setDetecting(false);
  }

  async function browse() {
    const dir = await api.openDirectoryDialog();
    if (dir) onChangeInstallPath(dir);
  }

  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><Monitor size={24} /></div>
      <h3>OBS Install Location</h3>
      <p className="onboarding-step-desc">
        OpenClip needs to know where OBS is installed so it can correctly install the
        recording plugin. This is the folder containing <code style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 4 }}>obs64.exe</code>.
      </p>

      <div className="form-group">
        <label className="form-label">OBS Install Folder</label>
        <div className="form-input-row">
          <input
            className="form-input"
            value={obsInstallPath || ''}
            onChange={e => onChangeInstallPath(e.target.value)}
            placeholder="e.g. C:\Program Files\obs-studio"
          />
          <button className="btn btn-secondary btn-sm" onClick={autoDetect} disabled={detecting} title="Auto-detect">
            <RefreshCw size={13} style={detecting ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>
          <button className="btn btn-secondary btn-sm" onClick={browse}>
            <FolderOpen size={13} />
          </button>
        </div>
      </div>

      <button
        className="onboarding-obs-link"
        onClick={() => api.openExternal('https://obsproject.com/download')}
      >
        <ExternalLink size={11} /> Don't have OBS? Install it here
      </button>
    </div>
  );
}

/** Step 3 – OBS Script (guided manual add + verify via marker file) */
function StepOBSPlugin({ pluginStatus, pluginInstallMsg, onVerify, scriptPath }) {
  const [copied, setCopied] = useState(false);

  function copyPath() {
    if (scriptPath) {
      navigator.clipboard.writeText(scriptPath).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><Download size={24} /></div>
      <h3>Add the OBS Script</h3>
      <p className="onboarding-step-desc">
        OpenClip controls OBS recordings via a Lua script.
        Add it once through OBS — <strong>OBS must be open</strong>.
      </p>

      <ol className="onboarding-instruction-list" style={{ marginBottom: 12 }}>
        <li>
          <span className="onboarding-step-num">1</span>
          <span>In OBS, go to <strong>Tools → Scripts</strong></span>
        </li>
        <li>
          <span className="onboarding-step-num">2</span>
          <span>Click <strong>"+"</strong> and browse to this file:</span>
        </li>
      </ol>

      <div className="form-input-row" style={{ marginBottom: 14 }}>
        <input
          className="form-input"
          value={scriptPath || 'Loading…'}
          readOnly
          style={{ fontFamily: 'monospace', fontSize: 11 }}
        />
        <button
          className="btn btn-secondary btn-sm"
          onClick={copyPath}
          title="Copy path to clipboard"
          style={{ whiteSpace: 'nowrap', minWidth: 76 }}
        >
          {copied ? <CheckCircle size={13} /> : <Copy size={13} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <ol className="onboarding-instruction-list" style={{ marginBottom: 14 }}>
        <li>
          <span className="onboarding-step-num">3</span>
          <span>Click <strong>Close</strong> in the Scripts dialog — the script loads instantly</span>
        </li>
      </ol>

      <div className="onboarding-install-row">
        <button
          className="btn btn-secondary btn-sm"
          onClick={onVerify}
          disabled={pluginStatus === 'checking' || pluginStatus === 'success'}
        >
          <CheckCircle size={13} /> Verify Script
        </button>
        <Status
          state={pluginStatus || null}
          message={
            pluginStatus === 'checking' ? 'Checking…' :
            pluginStatus === 'success'  ? 'Script is running in OBS ✓' :
            pluginStatus === 'error'    ? (pluginInstallMsg || 'Script not detected — open OBS and add it first') : null
          }
        />
      </div>
    </div>
  );
}


/** Step 4 – OBS WebSocket */
function StepWebSocket({ settings, onChange, wsStatus, onTest, onPasteQR, onBrowseQR, qrMsg }) {
  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><Wifi size={24} /></div>
      <h3>OBS WebSocket</h3>
      <p className="onboarding-step-desc">
        OpenClip connects to OBS via WebSocket to auto-create scenes and control
        recording. Enable it in OBS under{' '}
        <strong>Tools → WebSocket Server Settings</strong>, then test below.
      </p>

      {/* QR import row */}
      <div className="onboarding-install-row" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
          Screenshot the QR in OBS and paste here, or browse for the image:
        </span>
        <button className="btn btn-secondary btn-sm" onClick={onPasteQR} title="Paste QR code image from clipboard (Ctrl+V)">
          <Clipboard size={13} /> Paste QR
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onBrowseQR}>
          <QrCode size={13} /> Browse QR
        </button>
      </div>
      {qrMsg && (
        <div className={`onboarding-status ${qrMsg.ok ? 'success' : 'error'}`} style={{ marginBottom: 10 }}>
          {qrMsg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />} {qrMsg.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginBottom: 8 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Host</label>
          <input
            className="form-input"
            value={settings.obsWebSocket?.host || 'localhost'}
            onChange={e => onChange('obsWebSocket.host', e.target.value)}
            placeholder="localhost"
          />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Port</label>
          <input
            type="number"
            className="form-input"
            value={settings.obsWebSocket?.port ?? 4455}
            onChange={e => onChange('obsWebSocket.port', parseInt(e.target.value) || 4455)}
            style={{ width: 90 }}
          />
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Password (optional)</label>
        <input
          type="password"
          className="form-input"
          value={settings.obsWebSocket?.password || ''}
          onChange={e => onChange('obsWebSocket.password', e.target.value)}
          placeholder="Leave blank if no password set"
        />
      </div>

      <div className="onboarding-install-row">
        <button className="btn btn-secondary btn-sm" onClick={onTest}>
          <Wifi size={13} /> Test Connection
        </button>
        <Status
          state={wsStatus?.state || null}
          message={
            wsStatus?.state === 'checking' ? 'Connecting…' :
            wsStatus?.state === 'success'  ? `Connected — ${wsStatus.version}` :
            wsStatus?.state === 'error'    ? wsStatus.message : null
          }
        />
      </div>
    </div>
  );
}

/** Step 5 – Clip Hotkey */
function StepHotkey({ settings, onChange }) {
  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><Keyboard size={24} /></div>
      <h3>Clip Marker Hotkey</h3>
      <p className="onboarding-step-desc">
        Press this key while gaming to drop a timestamp you can clip later.
        Pick something easy to reach mid-game — <strong>F9</strong> is a popular choice.
      </p>
      <div className="form-group">
        <label className="form-label">Hotkey</label>
        <HotkeyCapture
          value={settings.clipMarkerHotkey || 'F9'}
          onChange={v => onChange('clipMarkerHotkey', v)}
        />
      </div>
    </div>
  );
}

/** Step 6 – Organize Recordings Destination */
function StepOrganizeDestination({ settings, onChange }) {
  async function browse() {
    const dir = await api.openDirectoryDialog();
    if (dir) onChange('destinationPath', dir);
  }

  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><FolderOpen size={24} /></div>
      <h3>Recordings Destination</h3>
      <p className="onboarding-step-desc">
        Choose where OpenClip should organize your recordings. After each session,
        recordings are moved here and sorted by game into subfolders automatically.
      </p>

      <div className="form-group">
        <label className="form-label">Organized Recordings Folder</label>
        <div className="form-input-row">
          <input
            className="form-input"
            value={settings.destinationPath || ''}
            onChange={e => onChange('destinationPath', e.target.value)}
            placeholder="e.g. C:\Users\You\Videos\Organized"
          />
          <button className="btn btn-secondary btn-sm" onClick={browse}>
            <FolderOpen size={13} />
          </button>
        </div>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          Tip: pick a folder separate from your OBS recording folder
        </span>
      </div>
    </div>
  );
}

/** Step 7 – Storage Management */
function StepStorage({ settings, onChange }) {
  const enabled = settings.autoDelete?.enabled;
  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><HardDrive size={24} /></div>
      <h3>Storage Management</h3>
      <p className="onboarding-step-desc">
        OpenClip can automatically delete old recordings to keep your disk from
        filling up. You can always change these limits later in Settings.
      </p>

      <div className="toggle-row" style={{ marginTop: 0 }}>
        <div>
          <div className="toggle-label">Auto-Delete Old Recordings</div>
          <div className="toggle-desc">Clean up recordings on watcher startup</div>
        </div>
        <button
          className={`toggle ${enabled ? 'on' : ''}`}
          onClick={() => onChange('autoDelete.enabled', !enabled)}
        />
      </div>

      {enabled && (
        <>
          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Max Storage (GB)</label>
            <input
              type="number"
              className="form-input"
              value={settings.autoDelete?.maxStorageGB ?? 50}
              onChange={e => onChange('autoDelete.maxStorageGB', parseInt(e.target.value) || 0)}
              style={{ width: 100 }}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Max Age (days)</label>
            <input
              type="number"
              className="form-input"
              value={settings.autoDelete?.maxAgeDays ?? 30}
              onChange={e => onChange('autoDelete.maxAgeDays', parseInt(e.target.value) || 0)}
              style={{ width: 100 }}
            />
          </div>
          <div className="toggle-row">
            <div>
              <div className="toggle-label">Exclude Clips from Auto-Delete</div>
              <div className="toggle-desc">Protect clips from being removed</div>
            </div>
            <button
              className={`toggle ${settings.autoDelete?.excludeClips ? 'on' : ''}`}
              onClick={() => onChange('autoDelete.excludeClips', !settings.autoDelete?.excludeClips)}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Step 8 – Auto-Clip */
function StepAutoClip({ settings, onChange }) {
  const enabled = settings.autoClip?.enabled;
  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><Scissors size={24} /></div>
      <h3>Auto-Clip</h3>
      <p className="onboarding-step-desc">
        When a recording ends, Auto-Clip automatically creates short clips around
        every marker you dropped during the session.
      </p>

      <div className="toggle-row" style={{ marginTop: 0 }}>
        <div>
          <div className="toggle-label">Enable Auto-Clip</div>
          <div className="toggle-desc">Automatically clip markers when recording ends</div>
        </div>
        <button
          className={`toggle ${enabled ? 'on' : ''}`}
          onClick={() => onChange('autoClip.enabled', !enabled)}
        />
      </div>

      {enabled && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Buffer Before (sec)</label>
              <input
                type="number"
                className="form-input"
                value={settings.autoClip?.bufferBefore ?? 15}
                onChange={e => onChange('autoClip.bufferBefore', parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Buffer After (sec)</label>
              <input
                type="number"
                className="form-input"
                value={settings.autoClip?.bufferAfter ?? 15}
                onChange={e => onChange('autoClip.bufferAfter', parseInt(e.target.value) || 0)}
              />
            </div>
          </div>
          <div className="toggle-row" style={{ marginTop: 4 }}>
            <div><div className="toggle-label">Remove Markers After Clipping</div></div>
            <button
              className={`toggle ${settings.autoClip?.removeMarkers ? 'on' : ''}`}
              onClick={() => onChange('autoClip.removeMarkers', !settings.autoClip?.removeMarkers)}
            />
          </div>
          <div className="toggle-row">
            <div>
              <div className="toggle-label">Delete Full Recording</div>
              <div className="toggle-desc">Keep only the clips, remove the original</div>
            </div>
            <button
              className={`toggle ${settings.autoClip?.deleteFullRecording ? 'on' : ''}`}
              onClick={() => onChange('autoClip.deleteFullRecording', !settings.autoClip?.deleteFullRecording)}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Step 9 – Watcher Autostart */
function StepWatcherAutostart({ settings, onChange }) {
  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><Play size={24} /></div>
      <h3>Watcher Autostart</h3>
      <p className="onboarding-step-desc">
        The Game Watcher detects when you launch a tracked game and tells OBS to start
        recording automatically. You can also start it manually from the Games page.
      </p>

      <div className="toggle-row" style={{ marginTop: 0 }}>
        <div>
          <div className="toggle-label">Start Watcher on App Launch</div>
          <div className="toggle-desc">Automatically watches for games when OpenClip opens</div>
        </div>
        <button
          className={`toggle ${settings.startWatcherOnStartup ? 'on' : ''}`}
          onClick={() => onChange('startWatcherOnStartup', !settings.startWatcherOnStartup)}
        />
      </div>

      <hr className="onboarding-divider" />
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
        🎉 You're all set! Click <strong>Finish</strong> to save your settings and start using OpenClip.
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   STEP REGISTRY  (10 steps total)
══════════════════════════════════════════════════════════ */
const STEP_TITLES = [
  'Welcome',           // 0
  'OBS Recordings',    // 1  — gated: path non-empty
  'OBS Install',       // 2  — gated: path non-empty
  'OBS Plugin',        // 3  — gated: plugin installed
  'WebSocket',         // 4  — gated: connection test passes
  'Clip Hotkey',       // 5
  'Recordings Dest.',  // 6  — gated: path non-empty
  'Storage',           // 7
  'Auto-Clip',         // 8
  'Watcher',           // 9
];
const TOTAL_STEPS = STEP_TITLES.length;

/* ══════════════════════════════════════════════════════════
   MAIN MODAL
══════════════════════════════════════════════════════════ */
export default function OnboardingModal({ open, onClose }) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(null);
  const [obsInstallPath, setObsInstallPath] = useState('');

  // Gated step state
  const [pluginStatus, setPluginStatus] = useState(null); // null | 'checking' | 'success' | 'error'
  const [pluginInstallMsg, setPluginInstallMsg] = useState('');
  const [scriptPath, setScriptPath] = useState('');
  const [wsStatus, setWsStatus] = useState(null);         // null | { state, version?, message? }
  const [qrMsg, setQrMsg] = useState(null);               // null | { ok: bool, text: string }

  // Load settings on open
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setPluginStatus(null);
    setPluginInstallMsg('');
    setWsStatus(null);
    setQrMsg(null);
    api.getStore('settings').then(s => setSettings(s));
    api.getOBSInstallPath?.().then(p => setObsInstallPath(p || '')).catch(() => {});
    // Load the lua script path so the user can copy-paste it
    api.getOBSScriptPath?.().then(p => setScriptPath(p || '')).catch(() => {});
  }, [open]);

  // When landing on step 3 (plugin), check if script is already running (marker file)
  useEffect(() => {
    if (step !== 3 || pluginStatus) return;
    api.isOBSScriptLoaded?.().then(loaded => {
      if (loaded) setPluginStatus('success');
    }).catch(() => {});
  }, [step, pluginStatus]);

  const updateSetting = useCallback((path, value) => {
    setSettings(prev => {
      const keys = path.split('.');
      const updated = { ...prev };
      let obj = updated;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return updated;
    });
  }, []);

  function handleInstallPathChange(p) {
    setObsInstallPath(p);
    api.setOBSInstallPath?.(p).catch(() => {});
  }

  // Whether Next is enabled for the current step
  function canAdvance() {
    if (step === 1) return !!(settings?.obsRecordingPath?.trim());
    if (step === 2) return !!(obsInstallPath?.trim());
    if (step === 3) return pluginStatus === 'success';
    if (step === 4) return wsStatus?.state === 'success';
    if (step === 6) return !!(settings?.destinationPath?.trim());
    return true;
  }

  async function handleVerifyPlugin() {
    setPluginStatus('checking');
    const loaded = await api.isOBSScriptLoaded?.().catch(() => false);
    if (loaded) {
      setPluginStatus('success');
      setPluginInstallMsg('');
    } else {
      setPluginStatus('error');
      setPluginInstallMsg('Script not detected — make sure OBS is open and the script is added via Tools → Scripts');
    }
  }

  function applyQRSettings(qrSettings) {
    const { host, port, password } = qrSettings;
    if (host !== undefined) updateSetting('obsWebSocket.host', host);
    if (port !== undefined) updateSetting('obsWebSocket.port', port);
    if (password !== undefined) updateSetting('obsWebSocket.password', password);
    const parts = [`${host || 'localhost'}:${port || 4455}`];
    if (password) parts.push('password imported');
    setQrMsg({ ok: true, text: `Imported from QR: ${parts.join(', ')}` });
  }

  async function handlePasteQR() {
    setQrMsg(null);
    const result = await api.readOBSWSQRFromClipboard().catch(() => ({ success: false, message: 'Clipboard error' }));
    if (!result.success) { setQrMsg({ ok: false, text: result.message }); return; }
    applyQRSettings(result.settings);
  }

  async function handleBrowseQR() {
    setQrMsg(null);
    const imagePath = await api.openFileDialog({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
    });
    if (!imagePath) return;
    const result = await api.readOBSWSQR(imagePath).catch(() => ({ success: false, message: 'Read error' }));
    if (!result.success) { setQrMsg({ ok: false, text: result.message }); return; }
    applyQRSettings(result.settings);
  }

  async function handleTestWS() {
    setWsStatus({ state: 'checking' });
    const result = await api.testOBSWSConnection(settings?.obsWebSocket).catch(() => ({ success: false, message: 'Connection error' }));
    setWsStatus(result.success
      ? { state: 'success', version: result.version }
      : { state: 'error', message: result.message }
    );
  }

  async function finishOrSkip(saveSettings = true) {
    if (saveSettings && settings) {
      await api.setStore('settings', settings).catch(() => {});
      await api.registerHotkey().catch(() => {});
    }
    await api.setOnboardingComplete(true).catch(() => {});
    onClose();
  }

  function goNext() {
    if (step < TOTAL_STEPS - 1) setStep(s => s + 1);
    else finishOrSkip(true);
  }

  if (!open || !settings) return null;

  const isLast = step === TOTAL_STEPS - 1;
  const nextDisabled = !canAdvance();

  // Tooltip for gated steps
  const gateHint = nextDisabled ? (
    step === 1 ? 'Enter or detect your OBS recording folder to continue' :
    step === 2 ? 'Enter or detect your OBS install location to continue' :
    step === 3 ? 'Add the script in OBS (Tools → Scripts), then click Verify Script' :
    step === 4 ? 'Click "Test Connection" and ensure it succeeds to continue' :
    step === 6 ? 'Choose a destination folder to continue' : undefined
  ) : undefined;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        {/* Header */}
        <div className="onboarding-header">
          <div className="onboarding-header-left">
            <h2>Setup Wizard</h2>
            <span>Step {step + 1} of {TOTAL_STEPS} — {STEP_TITLES[step]}</span>
          </div>
          <button className="onboarding-skip-btn" onClick={() => finishOrSkip(false)} title="Skip setup">
            <X size={18} />
          </button>
        </div>

        {/* Progress dots */}
        <div className="onboarding-progress">
          {STEP_TITLES.map((_, i) => (
            <div
              key={i}
              className={`onboarding-dot ${i === step ? 'active' : i < step ? 'done' : ''}`}
            />
          ))}
        </div>

        {/* Body */}
        <div className="onboarding-body">
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepOBSPath settings={settings} onChange={updateSetting} />}
          {step === 2 && (
            <StepOBSInstall
              obsInstallPath={obsInstallPath}
              onChangeInstallPath={handleInstallPathChange}
            />
          )}
          {step === 3 && (
            <StepOBSPlugin
              pluginStatus={pluginStatus}
              pluginInstallMsg={pluginInstallMsg}
              scriptPath={scriptPath}
              onVerify={handleVerifyPlugin}
            />
          )}
          {step === 4 && (
            <StepWebSocket
              settings={settings}
              onChange={updateSetting}
              wsStatus={wsStatus}
              onTest={handleTestWS}
              onPasteQR={handlePasteQR}
              onBrowseQR={handleBrowseQR}
              qrMsg={qrMsg}
            />
          )}
          {step === 5 && <StepHotkey settings={settings} onChange={updateSetting} />}
          {step === 6 && <StepOrganizeDestination settings={settings} onChange={updateSetting} />}
          {step === 7 && <StepStorage settings={settings} onChange={updateSetting} />}
          {step === 8 && <StepAutoClip settings={settings} onChange={updateSetting} />}
          {step === 9 && <StepWatcherAutostart settings={settings} onChange={updateSetting} />}
        </div>

        {/* Footer */}
        <div className="onboarding-footer">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => finishOrSkip(false)}
            style={{ color: 'var(--text-muted)', fontSize: 12 }}
          >
            Skip setup
          </button>

          <div className="onboarding-footer-right">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setStep(s => s - 1)}
              disabled={step === 0}
              style={{ opacity: step === 0 ? 0.4 : 1 }}
            >
              <ChevronLeft size={14} /> Back
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={goNext}
              disabled={nextDisabled}
              style={{ opacity: nextDisabled ? 0.4 : 1 }}
              title={gateHint}
            >
              {isLast ? 'Finish' : 'Next'} {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
