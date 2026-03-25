import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react'
import { RefreshCw, Undo2 } from 'lucide-react'
import api from '../api'
import { SettingsSectionCard } from '../settings/GeneralSettingsSections'

const ENCODERS = [
  'obs_nvenc_hevc_tex',
  'obs_nvenc_h264_tex',
  'obs_nvenc_av1_tex',
  'jim_nvenc',
  'jim_hevc_nvenc',
  'obs_x264',
  'obs_x265',
  'amd_amf_h264',
  'amd_amf_hevc',
  'amd_amf_av1',
  'obs_qsv11_h264',
  'obs_qsv11_hevc',
  'obs_qsv11_av1',
]

const FORMATS = ['mkv', 'mp4', 'hybrid_mp4', 'flv', 'ts', 'mov', 'm3u8']
const RESOLUTIONS = ['1920x1080', '2560x1440', '3840x2160', '1280x720', '1600x900']
const FPS_OPTIONS = ['30', '60', '120', '144', '240']
const RATE_CONTROLS = ['CQP', 'CBR', 'VBR', 'CQVBR', 'Lossless']
const PRESETS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']

const DEFAULT_SETTINGS = {
  output_cx: '1920',
  output_cy: '1080',
  fps_common: '60',
  rec_encoder: '',
  rec_format: 'mkv',
  output_mode: 'Simple',
  rate_control: '',
  bitrate: '',
  max_bitrate: '',
  cqp: '',
  target_quality: '',
  preset: '',
}

function encodingValuesEqual(a, b) {
  if (!a || !b) return false
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (String(a[k] ?? '') !== String(b[k] ?? '')) return false
  }
  return true
}

function isEncodingDirty(settings, baselineStr) {
  if (!baselineStr) return false
  try {
    const baseline = JSON.parse(baselineStr)
    return !encodingValuesEqual(settings, baseline)
  } catch {
    return true
  }
}

/** @param {string} type */
function encodingStatusMessageColor(type) {
  switch (type) {
    case 'ok':
      return 'var(--accent-green, #4caf50)'
    case 'err':
      return 'var(--accent-red,   #f44336)'
    default:
      return 'var(--accent-warn,  #f5a623)'
  }
}

const EncodingSettingsContext = createContext(/** @type {null} */ (null))

function useEncodingSettings() {
  const ctx = useContext(EncodingSettingsContext)
  if (!ctx) throw new Error('useEncodingSettings must be used under EncodingSettingsProvider')
  return ctx
}

export const EncodingSettingsProvider = forwardRef(function EncodingSettingsProvider(
  { onEncodingStateChange, children },
  ref
) {
  const [profiles, setProfiles] = useState([])
  const [profileDir, setProfileDir] = useState(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [baselineStr, setBaselineStr] = useState(null)
  const [obsRunning, setObsRunning] = useState(false)
  const [status, setStatus] = useState({ msg: '', type: '' })

  const isDirty =
    !!profileDir && baselineStr !== null && isEncodingDirty(settings, baselineStr)

  useEffect(() => {
    const canSave = !!profileDir && baselineStr !== null && !obsRunning
    onEncodingStateChange?.({ dirty: isDirty, canSave })
  }, [isDirty, profileDir, baselineStr, obsRunning, onEncodingStateChange])

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      const running = await api.isOBSRunning()
      if (!cancelled) setObsRunning(running)
    }
    tick()
    const id = setInterval(tick, 2500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  async function load() {
    const profs = await api.getOBSProfiles()
    setProfiles(profs || [])
    if (profs?.length) {
      await loadProfile(profs[0].dir)
    } else {
      setProfileDir(null)
      setBaselineStr(null)
      setStatus({ msg: 'No OBS profile found. Make sure OBS Studio is installed.', type: 'err' })
    }
  }

  async function loadProfile(dir) {
    setProfileDir(dir)
    const s = await api.getEncodingSettings(dir)
    if (s) {
      const merged = { ...DEFAULT_SETTINGS, ...s }
      setSettings(merged)
      setBaselineStr(JSON.stringify(merged))
      setStatus({ msg: '', type: '' })
    } else {
      setBaselineStr(null)
      setStatus({ msg: 'Could not read profile settings.', type: 'err' })
    }
    const running = await api.isOBSRunning()
    setObsRunning(running)
  }

  const resetToBaseline = useCallback(() => {
    if (!baselineStr) return
    try {
      setSettings(JSON.parse(baselineStr))
      setStatus({ msg: '', type: '' })
    } catch {
      setStatus({ msg: 'Could not reset settings.', type: 'err' })
    }
  }, [baselineStr])

  useImperativeHandle(
    ref,
    () => ({
      resetToBaseline,
      async save() {
        if (!profileDir) return false

        const running = await api.isOBSRunning()
        setObsRunning(running)
        if (running) {
          setStatus({
            msg: 'Close OBS before saving encoding settings.',
            type: 'err',
          })
          return false
        }

        const [cx, cy] = (settings.output_cx + 'x' + settings.output_cy).split('x')
        if (!cx || !cy || isNaN(parseInt(cx, 10)) || isNaN(parseInt(cy, 10))) {
          setStatus({ msg: 'Invalid resolution format.', type: 'err' })
          return false
        }

        try {
          await api.setEncodingSettings(profileDir, settings)
          setBaselineStr(JSON.stringify(settings))
          setStatus({ msg: '', type: '' })
          return true
        } catch (e) {
          setStatus({ msg: `Save failed: ${e.message}`, type: 'err' })
          return false
        }
      },
    }),
    [profileDir, settings, resetToBaseline]
  )

  function set(key, value) {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  const resolution = `${settings.output_cx}x${settings.output_cy}`

  function onResolutionChange(val) {
    const [cx, cy] = val.split('x')
    setSettings((s) => ({ ...s, output_cx: cx || s.output_cx, output_cy: cy || s.output_cy }))
  }

  const value = {
    profiles,
    profileDir,
    settings,
    set,
    load,
    loadProfile,
    resetToBaseline,
    baselineStr,
    obsRunning,
    status,
    setStatus,
    isDirty,
    resolution,
    onResolutionChange,
    ENCODERS,
    FORMATS,
    RESOLUTIONS,
    FPS_OPTIONS,
    RATE_CONTROLS,
    PRESETS,
  }

  return (
    <EncodingSettingsContext.Provider value={value}>{children}</EncodingSettingsContext.Provider>
  )
})

function encodingCardHeaderExtras(ctx) {
  let headerActions = null
  if (ctx.isDirty && ctx.baselineStr) {
    headerActions = (
      <button
        type="button"
        className="btn btn-icon btn-sm"
        onClick={ctx.resetToBaseline}
        title="Discard changes and restore last loaded or saved values"
        aria-label="Revert to saved"
      >
        <Undo2 size={16} />
      </button>
    )
  }
  return {
    titleAddon: ctx.obsRunning ? (
      <p className="encoding-section-obs-warn" role="status">
        OBS is running. Close OBS to save encoding settings.
      </p>
    ) : null,
    headerActions,
  }
}

/**
 * @param {object} props
 * @param {string} props.sectionId
 * @param {string} props.sectionTitle
 */
export function EncodingSettingsSection({ sectionId, sectionTitle }) {
  const ctx = useEncodingSettings()
  const { titleAddon, headerActions } = encodingCardHeaderExtras(ctx)

  switch (sectionId) {
    case 'encoding-profile':
      return (
        <SettingsSectionCard title={sectionTitle} titleAddon={titleAddon} headerActions={headerActions}>
          <div className="form-group" style={{ marginTop: 0 }}>
            <div className="form-input-row">
              <select
                className="form-input"
                value={ctx.profileDir || ''}
                onChange={(e) => ctx.loadProfile(e.target.value)}
              >
                {ctx.profiles.map((p) => (
                  <option key={p.dir} value={p.dir}>
                    {p.name}
                  </option>
                ))}
                {ctx.profiles.length === 0 && <option value="">No profiles found</option>}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={ctx.load} title="Reload profiles">
                <RefreshCw size={13} />
              </button>
            </div>
            {ctx.profileDir && (
              <span
                style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}
              >
                Output mode: <strong>{ctx.settings.output_mode}</strong>
              </span>
            )}
          </div>
          {ctx.status.msg && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <span style={{ color: encodingStatusMessageColor(ctx.status.type) }}>
                {ctx.status.msg}
              </span>
            </div>
          )}
        </SettingsSectionCard>
      )

    case 'encoding-video':
      return (
        <SettingsSectionCard title={sectionTitle} titleAddon={titleAddon} headerActions={headerActions}>
          <div className="form-group" style={{ marginTop: 0 }}>
            <label className="form-label">Output Resolution</label>
            <div className="form-input-row">
              <select
                className="form-input"
                value={ctx.RESOLUTIONS.includes(ctx.resolution) ? ctx.resolution : ''}
                onChange={(e) => ctx.onResolutionChange(e.target.value)}
                style={{ width: 160 }}
              >
                {!ctx.RESOLUTIONS.includes(ctx.resolution) && (
                  <option value="">{ctx.resolution}</option>
                )}
                {ctx.RESOLUTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                className="form-input"
                value={ctx.settings.output_cx}
                onChange={(e) => ctx.set('output_cx', e.target.value)}
                placeholder="W"
                style={{ width: 70 }}
              />
              <span style={{ alignSelf: 'center', color: 'var(--text-muted)' }}>×</span>
              <input
                className="form-input"
                value={ctx.settings.output_cy}
                onChange={(e) => ctx.set('output_cy', e.target.value)}
                placeholder="H"
                style={{ width: 70 }}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">FPS</label>
            <select
              className="form-input"
              value={ctx.settings.fps_common}
              onChange={(e) => ctx.set('fps_common', e.target.value)}
              style={{ width: 120 }}
            >
              {ctx.FPS_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </SettingsSectionCard>
      )

    case 'encoding-recording':
      return (
        <SettingsSectionCard title={sectionTitle} titleAddon={titleAddon} headerActions={headerActions}>
          <div className="form-group" style={{ marginTop: 0 }}>
            <div
              className="form-input-row"
              style={{ alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}
            >
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <label className="form-label">Encoder</label>
                <select
                  className="form-input"
                  value={ctx.settings.rec_encoder}
                  onChange={(e) => ctx.set('rec_encoder', e.target.value)}
                >
                  {!ctx.ENCODERS.includes(ctx.settings.rec_encoder) && ctx.settings.rec_encoder && (
                    <option value={ctx.settings.rec_encoder}>{ctx.settings.rec_encoder}</option>
                  )}
                  {ctx.ENCODERS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: '0 0 auto', width: 160 }}>
                <label className="form-label">Container Format</label>
                <select
                  className="form-input"
                  value={ctx.settings.rec_format}
                  onChange={(e) => ctx.set('rec_format', e.target.value)}
                  style={{ width: '100%' }}
                >
                  {ctx.FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </SettingsSectionCard>
      )

    case 'encoding-encoder':
      return (
        <SettingsSectionCard title={sectionTitle} titleAddon={titleAddon} headerActions={headerActions}>
          <span
            style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 12 }}
          >
            Written to recordEncoder.json in the OBS profile folder
          </span>

          <div className="form-group">
            <label className="form-label">Rate Control</label>
            <select
              className="form-input"
              value={ctx.settings.rate_control}
              onChange={(e) => ctx.set('rate_control', e.target.value)}
              style={{ width: 160 }}
            >
              <option value="">(unchanged)</option>
              {ctx.RATE_CONTROLS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Bitrate (kbps)</label>
            <input
              type="number"
              className="form-input"
              value={ctx.settings.bitrate}
              onChange={(e) => ctx.set('bitrate', e.target.value)}
              placeholder="e.g. 20000"
              style={{ width: 140 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Max Bitrate (kbps)</label>
            <input
              type="number"
              className="form-input"
              value={ctx.settings.max_bitrate}
              onChange={(e) => ctx.set('max_bitrate', e.target.value)}
              placeholder="e.g. 30000"
              style={{ width: 140 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">CQP Level</label>
            <input
              type="number"
              className="form-input"
              value={ctx.settings.cqp}
              onChange={(e) => ctx.set('cqp', e.target.value)}
              placeholder="e.g. 18"
              style={{ width: 100 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Target Quality</label>
            <input
              type="number"
              className="form-input"
              value={ctx.settings.target_quality}
              onChange={(e) => ctx.set('target_quality', e.target.value)}
              placeholder="e.g. 24"
              style={{ width: 100 }}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Preset</label>
            <div className="form-input-row">
              <select
                className="form-input"
                value={ctx.settings.preset}
                onChange={(e) => ctx.set('preset', e.target.value)}
                style={{ width: 120 }}
              >
                <option value="">(unchanged)</option>
                {ctx.PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                p1 = fastest &nbsp;·&nbsp; p7 = best quality
              </span>
            </div>
          </div>
        </SettingsSectionCard>
      )

    default:
      return null
  }
}

export default EncodingSettingsProvider
