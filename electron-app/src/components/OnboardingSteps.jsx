import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronRight, ChevronLeft, FolderOpen, RefreshCw,
  Download, CheckCircle, AlertCircle, Loader, Keyboard,
  HardDrive, Scissors, Play, ExternalLink, Package, Monitor,
} from 'lucide-react';
import api from '../api';

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

export function HotkeyCapture({ value, onChange }) {
  const [listening, setListening] = useState(false);
  const [useMods, setUseMods] = useState(() => (value || '').includes('+'));
  const ref = useRef(null);

  useEffect(() => { if (!listening) setUseMods((value || '').includes('+')); }, [value]);

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
        <button type="button" aria-label="Include modifier keys" aria-pressed={useMods} className={`toggle ${useMods ? 'on' : ''}`} onClick={() => setUseMods(m => !m)} />
      </div>
    </div>
  );
}

export function Status({ state, message }) {
  if (!state) return null;
  const icon = state === 'checking'
    ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
    : state === 'success' ? <CheckCircle size={12} /> : <AlertCircle size={12} />;
  return <div className={`onboarding-status ${state}`}>{icon}{message}</div>;
}

export function StepWelcome() {
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

export function StepOBSPath({ settings, onChange }) {
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

export function StepOBSInstall({ obsInstallPath, onChangeInstallPath }) {
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

export function StepOBSPlugin({ pluginStatus, pluginInstallMsg, onInstall, onReinstall, onVerify }) {
  return (
    <div className="onboarding-step">
      <div className="onboarding-step-icon"><Download size={24} /></div>
      <h3>Install OBS Plugin</h3>
      <p className="onboarding-step-desc">
        OpenClip uses a native OBS plugin to control recording and scene management.
        Click the button below to install it automatically — no manual steps required.
      </p>

      <div className="onboarding-install-row" style={{ marginBottom: 12 }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={onInstall}
          disabled={pluginStatus === 'checking' || pluginStatus === 'success'}
        >
          <Download size={13} /> Install Plugin
        </button>
        <Status
          state={pluginStatus || null}
          message={
            pluginStatus === 'checking' ? 'Installing…' :
            pluginStatus === 'success'  ? 'Plugin installed ✓' :
            pluginStatus === 'error'    ? (pluginInstallMsg || 'Installation failed') : null
          }
        />
        {pluginStatus === 'success' && (
          <button
            type="button"
            onClick={onReinstall}
            style={{ background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', textDecoration: 'underline' }}
          >
            Reinstall
          </button>
        )}
      </div>

      {pluginStatus === 'success' && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          If OBS is already running, restart it to load the plugin.
        </p>
      )}

      {pluginStatus === 'error' && (
        <div className="onboarding-install-row">
          <button
            className="btn btn-secondary btn-sm"
            onClick={onVerify}
          >
            <CheckCircle size={13} /> Check Again
          </button>
        </div>
      )}
    </div>
  );
}

export function StepHotkey({ settings, onChange }) {
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

export function StepOrganizeDestination({ settings, onChange }) {
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

export function StepStorage({ settings, onChange }) {
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
              min="0"
              value={settings.autoDelete?.maxStorageGB ?? 50}
              onChange={e => onChange('autoDelete.maxStorageGB', Math.max(0, parseInt(e.target.value) || 0))}
              style={{ width: 100 }}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Max Age (days)</label>
            <input
              type="number"
              className="form-input"
              min="0"
              value={settings.autoDelete?.maxAgeDays ?? 30}
              onChange={e => onChange('autoDelete.maxAgeDays', Math.max(0, parseInt(e.target.value) || 0))}
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

export function StepAutoClip({ settings, onChange }) {
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
                min="0"
                value={settings.autoClip?.bufferBefore ?? 15}
                onChange={e => onChange('autoClip.bufferBefore', Math.max(0, parseInt(e.target.value) || 0))}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Buffer After (sec)</label>
              <input
                type="number"
                className="form-input"
                min="0"
                value={settings.autoClip?.bufferAfter ?? 15}
                onChange={e => onChange('autoClip.bufferAfter', Math.max(0, parseInt(e.target.value) || 0))}
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

export function StepWatcherAutostart({ settings, onChange }) {
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
        You're all set! Click <strong>Finish</strong> to save your settings and start using OpenClip.
      </p>
    </div>
  );
}

export const STEP_TITLES = [
  'Welcome',
  'OBS Recordings',
  'OBS Install',
  'OBS Plugin',
  'Clip Hotkey',
  'Recordings Dest.',
  'Storage',
  'Auto-Clip',
  'Watcher',
];
export const TOTAL_STEPS = STEP_TITLES.length;
