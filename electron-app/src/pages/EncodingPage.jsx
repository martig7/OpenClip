import { useState, useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../api';

const ENCODERS = [
  'obs_nvenc_hevc_tex', 'obs_nvenc_h264_tex', 'obs_nvenc_av1_tex',
  'jim_nvenc', 'jim_hevc_nvenc',
  'obs_x264', 'obs_x265',
  'amd_amf_h264', 'amd_amf_hevc', 'amd_amf_av1',
  'obs_qsv11_h264', 'obs_qsv11_hevc', 'obs_qsv11_av1',
];

const FORMATS     = ['mkv', 'mp4', 'hybrid_mp4', 'flv', 'ts', 'mov', 'm3u8'];
const RESOLUTIONS = ['1920x1080', '2560x1440', '3840x2160', '1280x720', '1600x900'];
const FPS_OPTIONS = ['30', '60', '120', '144', '240'];
const RATE_CONTROLS = ['CQP', 'CBR', 'VBR', 'CQVBR', 'Lossless'];
const PRESETS     = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

const DEFAULT_SETTINGS = {
  output_cx: '1920', output_cy: '1080', fps_common: '60',
  rec_encoder: '', rec_format: 'mkv', output_mode: 'Simple',
  rate_control: '', bitrate: '', max_bitrate: '', cqp: '', target_quality: '', preset: '',
};

export default function EncodingPage() {
  const [profiles, setProfiles]       = useState([]);
  const [profileDir, setProfileDir]   = useState(null);
  const [settings, setSettings]       = useState(DEFAULT_SETTINGS);
  const [obsRunning, setObsRunning]   = useState(false);
  const [status, setStatus]           = useState({ msg: '', type: '' }); // type: 'ok'|'err'|'warn'
  const pendingTimers = useRef([]);

  useEffect(() => {
    return () => pendingTimers.current.forEach(clearTimeout);
  }, []);

  useEffect(() => { load(); }, []);

  async function load() {
    const profs = await api.getOBSProfiles();
    setProfiles(profs || []);
    if (profs?.length) {
      await loadProfile(profs[0].dir);
    } else {
      setStatus({ msg: 'No OBS profile found. Make sure OBS Studio is installed.', type: 'err' });
    }
  }

  async function loadProfile(dir) {
    setProfileDir(dir);
    const s = await api.getEncodingSettings(dir);
    if (s) {
      setSettings({ ...DEFAULT_SETTINGS, ...s });
      setStatus({ msg: '', type: '' });
    } else {
      setStatus({ msg: 'Could not read profile settings.', type: 'err' });
    }
    const running = await api.isOBSRunning();
    setObsRunning(running);
  }

  async function save() {
    if (!profileDir) return;

    const running = await api.isOBSRunning();
    if (running) {
      setObsRunning(true);
      // Show inline warning but still allow save
    }

    const [cx, cy] = (settings.output_cx + 'x' + settings.output_cy).split('x');
    if (!cx || !cy || isNaN(parseInt(cx)) || isNaN(parseInt(cy))) {
      setStatus({ msg: 'Invalid resolution format.', type: 'err' });
      return;
    }

    try {
      await api.setEncodingSettings(profileDir, settings);
      setStatus({ msg: 'Settings saved successfully.', type: 'ok' });
      pendingTimers.current.push(setTimeout(() => setStatus({ msg: '', type: '' }), 3000));
    } catch (e) {
      setStatus({ msg: `Save failed: ${e.message}`, type: 'err' });
    }
  }

  function set(key, value) {
    setSettings(s => ({ ...s, [key]: value }));
  }

  // Split resolution for display
  const resolution = `${settings.output_cx}x${settings.output_cy}`;

  function onResolutionChange(val) {
    const [cx, cy] = val.split('x');
    setSettings(s => ({ ...s, output_cx: cx || s.output_cx, output_cy: cy || s.output_cy }));
  }

  return (
    <>
      <div className="page-header">
        <h1>OBS Encoding</h1>
        <p>Configure the OBS recording encoder settings written to your active profile</p>
      </div>

      <div className="page-body" style={{ maxWidth: 640 }}>

        {/* Profile selector */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Profile</div>
          <div className="form-group" style={{ marginTop: 12 }}>
            <div className="form-input-row">
              <select
                className="form-input"
                value={profileDir || ''}
                onChange={e => loadProfile(e.target.value)}
              >
                {profiles.map(p => (
                  <option key={p.dir} value={p.dir}>{p.name}</option>
                ))}
                {profiles.length === 0 && <option value="">No profiles found</option>}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={load} title="Reload">
                <RefreshCw size={13} />
              </button>
            </div>
            {profileDir && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                Output mode: <strong>{settings.output_mode}</strong>
                {obsRunning && (
                  <span style={{ color: 'var(--accent-warn, #f5a623)', marginLeft: 12 }}>
                    ⚠ OBS is running — changes may be overwritten when OBS closes
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Video */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Video</div>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Output Resolution</label>
            <div className="form-input-row">
              <select
                className="form-input"
                value={RESOLUTIONS.includes(resolution) ? resolution : ''}
                onChange={e => onResolutionChange(e.target.value)}
                style={{ width: 160 }}
              >
                {!RESOLUTIONS.includes(resolution) && (
                  <option value="">{resolution}</option>
                )}
                {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <input
                className="form-input"
                value={settings.output_cx}
                onChange={e => set('output_cx', e.target.value)}
                placeholder="W"
                style={{ width: 70 }}
              />
              <span style={{ alignSelf: 'center', color: 'var(--text-muted)' }}>×</span>
              <input
                className="form-input"
                value={settings.output_cy}
                onChange={e => set('output_cy', e.target.value)}
                placeholder="H"
                style={{ width: 70 }}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">FPS</label>
            <select
              className="form-input"
              value={settings.fps_common}
              onChange={e => set('fps_common', e.target.value)}
              style={{ width: 120 }}
            >
              {FPS_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        {/* Recording output */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Recording Output</div>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Encoder</label>
            <select
              className="form-input"
              value={settings.rec_encoder}
              onChange={e => set('rec_encoder', e.target.value)}
            >
              {!ENCODERS.includes(settings.rec_encoder) && settings.rec_encoder && (
                <option value={settings.rec_encoder}>{settings.rec_encoder}</option>
              )}
              {ENCODERS.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Container Format</label>
            <select
              className="form-input"
              value={settings.rec_format}
              onChange={e => set('rec_format', e.target.value)}
              style={{ width: 160 }}
            >
              {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        {/* Encoder settings (recordEncoder.json) */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Encoder Settings</div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 12 }}>
            Written to recordEncoder.json in the OBS profile folder
          </span>

          <div className="form-group">
            <label className="form-label">Rate Control</label>
            <select
              className="form-input"
              value={settings.rate_control}
              onChange={e => set('rate_control', e.target.value)}
              style={{ width: 160 }}
            >
              <option value="">— unchanged —</option>
              {RATE_CONTROLS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Bitrate (kbps)</label>
            <input
              type="number"
              className="form-input"
              value={settings.bitrate}
              onChange={e => set('bitrate', e.target.value)}
              placeholder="e.g. 20000"
              style={{ width: 140 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Max Bitrate (kbps)</label>
            <input
              type="number"
              className="form-input"
              value={settings.max_bitrate}
              onChange={e => set('max_bitrate', e.target.value)}
              placeholder="e.g. 30000"
              style={{ width: 140 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">CQP Level</label>
            <input
              type="number"
              className="form-input"
              value={settings.cqp}
              onChange={e => set('cqp', e.target.value)}
              placeholder="e.g. 18"
              style={{ width: 100 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Target Quality</label>
            <input
              type="number"
              className="form-input"
              value={settings.target_quality}
              onChange={e => set('target_quality', e.target.value)}
              placeholder="e.g. 24"
              style={{ width: 100 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Preset</label>
            <div className="form-input-row">
              <select
                className="form-input"
                value={settings.preset}
                onChange={e => set('preset', e.target.value)}
                style={{ width: 120 }}
              >
                <option value="">— unchanged —</option>
                {PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                p1 = fastest &nbsp;·&nbsp; p7 = best quality
              </span>
            </div>
          </div>
        </div>

        {/* Save */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={!profileDir}
          >
            Save Encoding Settings
          </button>
          {status.msg && (
            <span style={{
              fontSize: 12,
              color: status.type === 'ok'  ? 'var(--accent-green, #4caf50)'
                   : status.type === 'err' ? 'var(--accent-red,   #f44336)'
                   :                         'var(--accent-warn,  #f5a623)',
            }}>
              {status.msg}
            </span>
          )}
        </div>

      </div>
    </>
  );
}
