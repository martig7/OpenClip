import {
  FolderOpen,
  RefreshCw,
  Download,
  Package,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader,
  Undo2,
} from 'lucide-react'
import { HotkeyCapture } from '../components/OnboardingSteps'
import api from '../api'
import { isSettingsSectionDirty } from './settingsSectionRevert'

const tc = 'toggle-row settings-toggle-row--compact'

const LOADER_SPIN_STYLE = { animation: 'spin 1s linear infinite' }

/** @param {(v: string) => void} setPath */
async function detectObsInstallPathToState(setPath) {
  const p = await api.detectOBSInstallPath()
  if (p) setPath(p)
}

/** @param {(v: string) => void} setPath */
async function browseObsInstallPathToState(setPath) {
  const dir = await api.openDirectoryDialog()
  if (dir) setPath(dir)
}

/** @param {import('react').ChangeEvent<HTMLInputElement>} e */
function parseIntInputOrZero(e) {
  return parseInt(e.target.value, 10) || 0
}

/**
 * @param {object} props
 * @param {string} props.title
 * @param {import('react').ReactNode} [props.children]
 * @param {import('react').ReactNode} [props.titleAddon] — e.g. note under the title (encoding OBS warning)
 * @param {import('react').ReactNode} [props.headerActions] — e.g. icon button (encoding revert)
 */
export function SettingsSectionCard({ title, children, titleAddon, headerActions }) {
  return (
    <div className="card settings-section-card">
      <div className="settings-section-card-header">
        <div className="settings-section-card-heading">
          <h2 className="settings-section-card-title">{title}</h2>
          {titleAddon}
        </div>
        {headerActions ? (
          <div className="settings-section-card-header-actions">{headerActions}</div>
        ) : null}
      </div>
      <div className="settings-section-card-body">{children}</div>
    </div>
  )
}

/**
 * @param {object} props
 * @param {string} props.sectionId
 * @param {string} props.sectionTitle
 * @param {object} props.settings
 * @param {string | null} props.settingsBaselineStr
 * @param {(sectionId: string) => void} props.onRevertSection
 * @param {import('react').ReactNode} props.children
 */
function AppSettingsSectionCard({
  sectionId,
  sectionTitle,
  settings,
  settingsBaselineStr,
  onRevertSection,
  children,
}) {
  const showRevert =
    settingsBaselineStr && isSettingsSectionDirty(sectionId, settings, settingsBaselineStr)
  const headerActions = showRevert ? (
    <button
      type="button"
      className="btn btn-icon btn-sm"
      onClick={() => onRevertSection(sectionId)}
      title="Discard changes in this section and restore last saved values"
      aria-label="Revert to saved"
    >
      <Undo2 size={16} />
    </button>
  ) : null
  return (
    <SettingsSectionCard title={sectionTitle} headerActions={headerActions}>
      {children}
    </SettingsSectionCard>
  )
}

/**
 * @param {object} props
 * @param {string} props.sectionTitle
 * @param {string} props.sectionId — single section to render
 * @param {object} props.settings
 * @param {string | null} props.settingsBaselineStr — JSON snapshot for per-section revert
 * @param {(sectionId: string) => void} props.onRevertSection
 * @param {(path: string, value: unknown) => void} props.updateSetting
 * @param {() => Promise<void>} props.detectOBSPath
 * @param {(key: string) => Promise<void>} props.browseDirectory
 * @param {string} props.obsInstallPath
 * @param {(v: string) => void} props.setObsInstallPath
 * @param {boolean | null} props.pluginInstalled
 * @param {boolean} props.pluginBusy
 * @param {{ ok: boolean, text: string } | null} props.pluginMsg
 * @param {() => Promise<void>} props.installPlugin
 * @param {() => Promise<void>} props.removePlugin
 * @param {object | null} props.updateStatus
 * @param {boolean} props.checkingUpdate
 * @param {() => Promise<void>} props.checkForUpdate
 * @param {() => Promise<void>} props.installUpdate
 */
export default function GeneralSettingsSection({
  sectionTitle,
  sectionId,
  settings,
  settingsBaselineStr,
  onRevertSection,
  updateSetting,
  detectOBSPath,
  browseDirectory,
  obsInstallPath,
  setObsInstallPath,
  pluginInstalled,
  pluginBusy,
  pluginMsg,
  installPlugin,
  removePlugin,
  updateStatus,
  checkingUpdate,
  checkForUpdate,
  installUpdate,
}) {
  const sectionCardProps = {
    sectionId,
    sectionTitle,
    settings,
    settingsBaselineStr,
    onRevertSection,
  }

  switch (sectionId) {
    case 'watcher':
      return (
        <AppSettingsSectionCard {...sectionCardProps}>
          <div className={tc} style={{ marginTop: 0 }}>
            <div>
              <div className="toggle-label">Start Watcher on Startup</div>
              <div className="toggle-desc">
                Automatically start the game watcher when the app launches
              </div>
            </div>
            <button
              type="button"
              className={`toggle ${settings.startWatcherOnStartup ? 'on' : ''}`}
              onClick={() =>
                updateSetting('startWatcherOnStartup', !settings.startWatcherOnStartup)
              }
            />
          </div>
        </AppSettingsSectionCard>
      )

    case 'organize':
      return (
        <AppSettingsSectionCard {...sectionCardProps}>
          <div className={tc} style={{ marginTop: 0 }}>
            <div>
              <div className="toggle-label">Remux to MP4</div>
              <div className="toggle-desc">
                Convert MKV and other formats to MP4 when organizing. Disable to move files without
                converting.
              </div>
            </div>
            <button
              type="button"
              className={`toggle ${settings.organizeRemux !== false ? 'on' : ''}`}
              onClick={() => updateSetting('organizeRemux', settings.organizeRemux === false)}
            />
          </div>
        </AppSettingsSectionCard>
      )

    case 'view':
      return (
        <AppSettingsSectionCard {...sectionCardProps}>
          <div className="form-group" style={{ marginTop: 0 }}>
            <label className="form-label">Storage View</label>
            <div className="toggle-desc" style={{ marginBottom: 6 }}>
              Choose how recordings and clips are displayed
            </div>
            <select
              className="form-input"
              value={settings.listView !== false ? 'list' : 'grid'}
              onChange={(e) => updateSetting('listView', e.target.value === 'list')}
            >
              <option value="list">List</option>
              <option value="grid">Grid</option>
            </select>
          </div>

          <div className="form-group" style={{ marginTop: 16 }}>
            <label className="form-label">Waveform Resolution</label>
            <div className="toggle-desc" style={{ marginBottom: 6 }}>
              Higher resolution shows more detail in audio waveforms but may take longer to load
            </div>
            <select
              className="form-input"
              value={settings.waveformResolution || 'default'}
              onChange={(e) => updateSetting('waveformResolution', e.target.value)}
            >
              <option value="low">Low (faster loading)</option>
              <option value="default">Standard (balanced)</option>
              <option value="high">High (more detail)</option>
            </select>
          </div>
        </AppSettingsSectionCard>
      )

    case 'hotkey':
      return (
        <AppSettingsSectionCard {...sectionCardProps}>
          <div className="form-group" style={{ marginTop: 0 }}>
            <label className="form-label">Hotkey</label>
            <HotkeyCapture
              value={settings.clipMarkerHotkey || 'F9'}
              onChange={(v) => updateSetting('clipMarkerHotkey', v)}
            />
            <span
              style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}
            >
              Press this key while gaming to mark a moment for clipping
            </span>
          </div>
        </AppSettingsSectionCard>
      )

    case 'autoclip':
      return (
        <AppSettingsSectionCard {...sectionCardProps}>
          <div className={tc} style={{ marginTop: 0 }}>
            <div>
              <div className="toggle-label">Enable Auto-Clip</div>
              <div className="toggle-desc">
                Automatically create clips from markers when recording ends
              </div>
            </div>
            <button
              type="button"
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
                  value={settings.autoClip?.bufferBefore ?? 30}
                  onChange={(e) =>
                    updateSetting('autoClip.bufferBefore', parseIntInputOrZero(e))
                  }
                  style={{ width: 100 }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Buffer After Marker (seconds)</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.autoClip?.bufferAfter ?? 5}
                  onChange={(e) =>
                    updateSetting('autoClip.bufferAfter', parseIntInputOrZero(e))
                  }
                  style={{ width: 100 }}
                />
              </div>

              <div className={tc}>
                <div>
                  <div className="toggle-label">Remove Markers After Clipping</div>
                </div>
                <button
                  type="button"
                  className={`toggle ${settings.autoClip?.removeMarkers ? 'on' : ''}`}
                  onClick={() =>
                    updateSetting('autoClip.removeMarkers', !settings.autoClip?.removeMarkers)
                  }
                />
              </div>

              <div className={tc}>
                <div>
                  <div className="toggle-label">Delete Full Recording</div>
                  <div className="toggle-desc">
                    Only keep the clips, delete the original recording
                  </div>
                </div>
                <button
                  type="button"
                  className={`toggle ${settings.autoClip?.deleteFullRecording ? 'on' : ''}`}
                  onClick={() =>
                    updateSetting(
                      'autoClip.deleteFullRecording',
                      !settings.autoClip?.deleteFullRecording
                    )
                  }
                />
              </div>
            </>
          )}
        </AppSettingsSectionCard>
      )

    case 'storage':
      return (
        <AppSettingsSectionCard {...sectionCardProps}>
          <div className="form-group" style={{ marginTop: 0 }}>
            <label className="form-label">Organized Recordings Destination</label>
            <div className="form-input-row">
              <input
                className="form-input"
                value={settings.destinationPath || ''}
                onChange={(e) => updateSetting('destinationPath', e.target.value)}
                placeholder="Where to organize recordings"
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => browseDirectory('destinationPath')}
              >
                <FolderOpen size={13} />
              </button>
            </div>
          </div>

          <div className={tc}>
            <div>
              <div className="toggle-label">Auto-Delete Old Recordings</div>
              <div className="toggle-desc">
                Automatically clean up old recordings on watcher startup
              </div>
            </div>
            <button
              type="button"
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
                  onChange={(e) =>
                    updateSetting('autoDelete.maxStorageGB', parseIntInputOrZero(e))
                  }
                  style={{ width: 100 }}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Max Age (days)</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.autoDelete?.maxAgeDays ?? 30}
                  onChange={(e) =>
                    updateSetting('autoDelete.maxAgeDays', parseIntInputOrZero(e))
                  }
                  style={{ width: 100 }}
                />
              </div>

              <div className={tc}>
                <div>
                  <div className="toggle-label">Exclude Clips from Auto-Delete</div>
                </div>
                <button
                  type="button"
                  className={`toggle ${settings.autoDelete?.excludeClips ? 'on' : ''}`}
                  onClick={() =>
                    updateSetting('autoDelete.excludeClips', !settings.autoDelete?.excludeClips)
                  }
                />
              </div>
            </>
          )}
        </AppSettingsSectionCard>
      )

    case 'plugin':
      return (
        <AppSettingsSectionCard {...sectionCardProps}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
            The OpenClip native plugin controls recording and scene management inside OBS.
          </p>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">OBS Recording Folder</label>
            <div className="form-input-row">
              <input
                className="form-input"
                value={settings.obsRecordingPath || ''}
                onChange={(e) => updateSetting('obsRecordingPath', e.target.value)}
                placeholder="Path to OBS recordings"
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={detectOBSPath}
                title="Auto-detect"
              >
                <RefreshCw size={13} />
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => browseDirectory('obsRecordingPath')}
              >
                <FolderOpen size={13} />
              </button>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">OBS Install Folder</label>
            <div className="form-input-row">
              <input
                className="form-input"
                value={obsInstallPath}
                onChange={(e) => setObsInstallPath(e.target.value)}
                placeholder="e.g. C:\Program Files\obs-studio"
              />
              <button
                className="btn btn-secondary btn-sm"
                title="Auto-detect"
                onClick={() => detectObsInstallPathToState(setObsInstallPath)}
              >
                <RefreshCw size={13} />
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => browseObsInstallPathToState(setObsInstallPath)}
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
              {pluginBusy && !pluginInstalled ? (
                <Loader size={13} style={LOADER_SPIN_STYLE} />
              ) : (
                <Package size={13} />
              )}
              {pluginInstalled ? 'Reinstall Plugin' : 'Install Plugin'}
            </button>
            {pluginInstalled && (
              <button
                className="btn btn-danger btn-sm"
                onClick={removePlugin}
                disabled={pluginBusy}
              >
                {pluginBusy ? (
                  <Loader size={13} style={LOADER_SPIN_STYLE} />
                ) : (
                  <Trash2 size={13} />
                )}
                Remove Plugin
              </button>
            )}
            {pluginMsg && (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 13,
                  color: pluginMsg.ok ? 'var(--text-muted)' : 'var(--color-error, #e55)',
                }}
              >
                {pluginMsg.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                {pluginMsg.text}
              </span>
            )}
            {pluginInstalled === null && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                <Loader
                  size={13}
                  style={{ ...LOADER_SPIN_STYLE, verticalAlign: 'middle' }}
                />{' '}
                Checking…
              </span>
            )}
            {pluginInstalled === false && !pluginMsg && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not installed</span>
            )}
            {pluginInstalled === true && !pluginMsg && (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 13,
                  color: 'var(--text-muted)',
                }}
              >
                <CheckCircle size={13} /> Installed
              </span>
            )}
          </div>
        </AppSettingsSectionCard>
      )

    case 'updates':
      return (
        <AppSettingsSectionCard {...sectionCardProps}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={checkForUpdate}
              disabled={checkingUpdate || updateStatus?.type === 'downloaded'}
            >
              <RefreshCw
                size={13}
                style={{ animation: checkingUpdate ? 'spin 1s linear infinite' : 'none' }}
              />
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
        </AppSettingsSectionCard>
      )

    default:
      return null
  }
}
