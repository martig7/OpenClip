import { useState, useEffect, useRef } from 'react'
import { Plus, Edit2, Trash2, RefreshCw, ChevronDown, Music, Mic, AlertTriangle } from 'lucide-react'
import api from '../../api'
import {
  AUDIO_KIND_META,
  AudioIcon,
  buildAvailableAudioInputs,
  getAppAudioWindowKey,
  isAppAudioKind,
} from './audioSourceUtils'
import { TrackLabelHeader, TrackChips } from './TrackChips'

/**
 * Unified audio sources card used in both master-list and per-scene contexts.
 *
 * mode="master" — master list on the Games page footer
 * mode="scene"  — per-scene sources in the game detail drawer / edit modal
 *
 * Mode only affects:
 *   master → "Edit Track Labels" button, no "Not in master" badges, no "Add from master" dropdown
 *   scene  → "Not in master" badges, "Add from master" dropdown, duplicate-window warning
 */
export default function AudioSourcesCard({
  mode,

  sources,
  loading,
  trackLabels,
  trackData,
  trackLoading,
  onToggleTrack,
  onRemoveSource,

  showAudioDropdown,
  setShowAudioDropdown,
  audioDropdownRef,
  availableAudioInputs,
  loadingAudioInputs,
  audioDropdownError,
  onLoadAudioInputs,
  onAddSource,

  setTrackLabels,
  showToast,
  applyingSource,

  game,
  masterAudioSources,
  onAddMasterSource,
  sceneName,
}) {
  const isMaster = mode === 'master'
  const isScene = mode === 'scene'

  const [showTrackEditor, setShowTrackEditor] = useState(false)
  const [tempTrackLabels, setTempTrackLabels] = useState([])
  const [savingTrackLabels, setSavingTrackLabels] = useState(false)

  const [localDropdownOpen, setLocalDropdownOpen] = useState(false)
  const [localAudioInputs, setLocalAudioInputs] = useState([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState(null)
  const localDropdownRef = useRef(null)

  const selfManaged = isScene && !audioDropdownRef
  const dropdownOpen = selfManaged ? localDropdownOpen : showAudioDropdown
  const setDropdownOpen = selfManaged ? setLocalDropdownOpen : setShowAudioDropdown
  const dropdownRef = selfManaged ? localDropdownRef : audioDropdownRef
  const audioInputs = selfManaged ? localAudioInputs : availableAudioInputs
  const isLoadingInputs = selfManaged ? localLoading : loadingAudioInputs
  const inputError = selfManaged ? localError : audioDropdownError

  useEffect(() => {
    if (selfManaged && sceneName) loadLocalAudioInputs()
  }, [])

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  async function loadLocalAudioInputs() {
    setLocalLoading(true)
    setLocalError(null)
    try {
      const combined = await buildAvailableAudioInputs()
      setLocalAudioInputs(combined)
    } catch (err) {
      setLocalError(err.message || 'Failed to load audio sources')
    } finally {
      setLocalLoading(false)
    }
  }

  function handleToggleDropdown() {
    if (!dropdownOpen) {
      setDropdownOpen(true)
      if (selfManaged) loadLocalAudioInputs()
      else onLoadAudioInputs?.()
    } else {
      setDropdownOpen(false)
    }
  }

  const [addFromMaster, setAddFromMaster] = useState('')
  const masterNames = isScene ? new Set((masterAudioSources || []).map((s) => s.name)) : null

  function isAlreadyInList(entry) {
    if (isMaster) {
      return sources.some((s) => (s.name || s.inputName) === entry.name)
    }
    return sources.some(
      (s) =>
        s.inputName === entry.name ||
        (entry.kind === 'magic_game_audio' && s.inputName.startsWith('Game Audio ('))
    )
  }

  function handleDropdownSelect(entry) {
    if (isScene && entry.kind === 'magic_game_audio' && game) {
      const exeGuess =
        game.exe ||
        (game.selector.toLowerCase().endsWith('.exe') ? game.selector : `${game.selector}.exe`)
      const windowClassGuess = game.windowClass || game.selector
      const titleGuess = game.selector
      onAddSource(sceneName, {
        name: `Game Audio (${game.name})`,
        kind: 'wasapi_process_output_capture',
        inputSettings: {
          window: `${titleGuess}:${windowClassGuess}:${exeGuess}`,
          window_match_priority:
            game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0,
        },
      })
    } else if (isScene) {
      onAddSource(sceneName, {
        name: entry.name,
        kind: entry.kind,
        inputSettings: entry.inputSettings || {},
      })
    } else {
      onAddSource(entry)
    }
    setDropdownOpen(false)
  }

  function srcName(src) { return src.inputName || src.name }
  function srcKind(src) { return src.inputKind || src.kind }

  return (
    <>
      <div className="card audio-sources-card" style={{ marginTop: isMaster ? 16 : 0 }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="card-title">Scene Audio Sources</span>
            {isScene && sceneName && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                — {sceneName}
              </span>
            )}
            {isMaster && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ padding: '3px 8px', fontSize: 10 }}
                onClick={() => {
                  setTempTrackLabels([...trackLabels])
                  setShowTrackEditor(true)
                }}
              >
                <Edit2 size={10} style={{ marginRight: 4 }} /> Edit Track Labels
              </button>
            )}
          </div>
          {(!isScene || sceneName) && !loading && (
            <div style={{ position: 'relative' }} ref={dropdownRef}>
              <button className="btn btn-primary btn-sm" onClick={handleToggleDropdown}>
                <Plus size={13} /> Add Source
              </button>

              {dropdownOpen && (
                <AddSourceDropdown
                  entries={audioInputs || []}
                  loading={isLoadingInputs}
                  error={inputError}
                  isAlreadyInList={isAlreadyInList}
                  onSelect={handleDropdownSelect}
                  dropdownTitle={isScene ? 'Add to Scene' : 'Select Audio Source'}
                />
              )}
            </div>
          )}
        </div>

        {isScene && !sceneName ? (
          <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
            Set an OBS scene name above to manage audio sources.
          </div>
        ) : loading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: 'var(--text-muted)',
              padding: '12px 16px',
            }}
          >
            <RefreshCw size={13} className="spinning" /> Loading scene audio sources…
          </div>
        ) : sources.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '28px 16px',
              gap: 8,
            }}
          >
            <Music size={28} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              No audio sources {isMaster ? 'added yet' : 'found in this scene'}.
            </div>
          </div>
        ) : (
          <>
            {isScene && <DuplicateAppAudioWarning sources={sources} />}

            <TrackLabelHeader trackLabels={trackLabels} className="master-track-header" />

            {sources.map((src, i) => {
              const name = srcName(src)
              const kind = srcKind(src)
              const meta = AUDIO_KIND_META[kind]
              const tracks = trackData[name] || {}
              const isTrackLoading = trackLoading[name]
              const isApplying = isMaster && applyingSource === name
              const isInMaster = isScene && masterNames && (
                masterNames.has(name) ||
                (name.startsWith('Game Audio (') && masterNames.has('Game Audio'))
              )
              const displayName = isScene && name.startsWith('Game Audio (') ? 'Game Audio' : name

              return (
                <div key={name || i} className="audio-source-row master-source-row">
                  <div className="audio-source-icon-wrap">
                    <AudioIcon kind={kind} size={15} />
                  </div>
                  <div className="audio-source-info">
                    <div className="audio-source-name">{displayName}</div>
                    <div className="audio-source-kind">{meta?.label || kind}</div>
                    {isScene && !isInMaster && (
                      <button
                        type="button"
                        className="audio-source-not-master-pill"
                        onClick={() => onAddMasterSource({ name, kind })}
                        title="Add to Master List"
                      >
                        <span>Not in master</span>
                        <Plus className="audio-source-not-master-pill__icon" size={11} strokeWidth={2.5} aria-hidden />
                      </button>
                    )}
                  </div>
                  <TrackChips
                    inputName={name}
                    tracks={tracks}
                    trackLabels={trackLabels}
                    isLoading={isTrackLoading}
                    onToggle={onToggleTrack}
                  />
                  <div className="track-action-col" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4 }}>
                    {isApplying && (
                      <RefreshCw size={11} className="spinning" style={{ color: 'var(--text-muted)' }} />
                    )}
                    <button
                      className="btn-icon"
                      onClick={() => {
                        if (isScene) onRemoveSource(sceneName, name)
                        else onRemoveSource(name)
                      }}
                      title={isMaster ? 'Remove from master list' : 'Remove from scene'}
                      style={{ color: 'var(--danger)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </>
        )}

        {isScene && sceneName && !loading && (masterAudioSources || []).length > 0 && (
          <div style={{ padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center', borderTop: sources.length > 0 ? '1px solid var(--border)' : 'none' }}>
            <select
              className="form-input"
              value={addFromMaster}
              onChange={(e) => setAddFromMaster(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">Add from master list…</option>
              {masterAudioSources
                .filter(
                  (s) =>
                    !sources.some(
                      (sc) =>
                        sc.inputName === s.name ||
                        (s.kind === 'magic_game_audio' && sc.inputName?.startsWith('Game Audio ('))
                    )
                )
                .map((s, i) => (
                  <option key={i} value={s.name}>{s.name}</option>
                ))}
            </select>
            <button
              className="btn btn-secondary btn-sm"
              disabled={!addFromMaster}
              onClick={() => {
                const src = masterAudioSources.find((s) => s.name === addFromMaster)
                if (!src) return
                handleDropdownSelect(src)
                setAddFromMaster('')
              }}
            >
              <Plus size={13} /> Add
            </button>
          </div>
        )}
      </div>

      {isMaster && showTrackEditor && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !savingTrackLabels) setShowTrackEditor(false)
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Track Labels</h2>
            <p>
              Customize the names of OBS audio tracks to easily identify them (e.g. "Stream Mix",
              "VOD Track"). These names will be saved to your OBS profile.
            </p>
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}
            >
              {[0, 1, 2, 3, 4, 5].map((idx) => (
                <div key={idx} className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Track {idx + 1}</label>
                  <input
                    className="form-input"
                    value={tempTrackLabels[idx] || ''}
                    placeholder={`Track ${idx + 1}`}
                    disabled={savingTrackLabels}
                    onChange={(e) => {
                      const newArr = [...tempTrackLabels]
                      newArr[idx] = e.target.value
                      setTempTrackLabels(newArr)
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowTrackEditor(false)}
                disabled={savingTrackLabels}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={savingTrackLabels}
                onClick={async () => {
                  setSavingTrackLabels(true)
                  try {
                    await api.setTrackNames(tempTrackLabels)
                    setTrackLabels(tempTrackLabels)
                    showToast('Track labels updated successfully')
                    setShowTrackEditor(false)
                  } catch {
                    showToast('Failed to save track labels')
                  } finally {
                    setSavingTrackLabels(false)
                  }
                }}
              >
                {savingTrackLabels ? <RefreshCw size={14} className="spinning" /> : 'Save Labels'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function AddSourceDropdown({ entries, loading, error, isAlreadyInList, onSelect, dropdownTitle }) {
  if (loading) {
    return (
      <DropdownShell title={dropdownTitle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
          <RefreshCw size={13} className="spinning" /> Loading audio sources…
        </div>
      </DropdownShell>
    )
  }
  if (error) {
    return (
      <DropdownShell title={dropdownTitle}>
        <div style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 4 }}>{error}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Make sure OBS is running and WebSocket is configured.</div>
        </div>
      </DropdownShell>
    )
  }
  if (entries.length === 0) {
    return (
      <DropdownShell title={dropdownTitle}>
        <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>No audio sources found. Ensure OBS is running.</div>
      </DropdownShell>
    )
  }

  return (
    <DropdownShell title={dropdownTitle}>
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        {['obs', 'windows', 'app'].map((group) => {
          const items = entries.filter((a) => a.source === group)
          if (items.length === 0) return null
          const groupLabel = { obs: 'OBS Inputs', windows: 'Windows Audio Devices', app: 'Applications' }[group]
          return (
            <div key={group}>
              <div
                style={{
                  padding: '6px 12px 2px',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  borderTop: group !== 'obs' ? '1px solid var(--border)' : 'none',
                  marginTop: group !== 'obs' ? 4 : 0,
                }}
              >
                {groupLabel}
              </div>
              {items.map((entry, i) => {
                const already = isAlreadyInList(entry)
                const meta = AUDIO_KIND_META[entry.kind]
                return (
                  <button
                    key={entry.name || i}
                    disabled={already}
                    onClick={() => !already && onSelect(entry)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '7px 14px',
                      background: 'none',
                      border: 'none',
                      cursor: already ? 'default' : 'pointer',
                      textAlign: 'left',
                      opacity: already ? 0.5 : 1,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { if (!already) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
                  >
                    {group === 'app' ? (
                      <ChevronDown size={14} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} />
                    ) : group === 'windows' && entry.kind === 'wasapi_input_capture' ? (
                      <Mic size={14} />
                    ) : group === 'windows' ? (
                      <Music size={14} />
                    ) : (
                      <AudioIcon kind={entry.kind} size={14} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {group === 'app'
                          ? 'Application Audio Capture'
                          : group === 'windows'
                            ? (entry.kind === 'wasapi_input_capture' ? 'Input device' : 'Output device')
                            : (meta?.label || entry.kind)}
                      </div>
                    </div>
                    {already && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>Added</span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </DropdownShell>
  )
}

function DropdownShell({ title, children }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        zIndex: 300,
        minWidth: 300,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-light)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          fontSize: 11,
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function DuplicateAppAudioWarning({ sources }) {
  const appSources = sources.filter((s) => isAppAudioKind(s.inputKind))
  if (appSources.length < 2) return null
  const keyGroups = {}
  for (const s of appSources) {
    const key = getAppAudioWindowKey(s.inputName, s.inputSettings?.window)
    if (!keyGroups[key]) keyGroups[key] = []
    keyGroups[key].push(s.inputName)
  }
  const duplicated = Object.values(keyGroups).filter((g) => g.length >= 2)
  if (duplicated.length === 0) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 7,
        padding: '7px 16px',
        background: 'rgba(245,158,11,0.10)',
        borderBottom: '1px solid rgba(245,158,11,0.35)',
        fontSize: 12,
        color: '#f59e0b',
      }}
    >
      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        This scene has two Application Audio sources targeting the same window
        {duplicated.map((g) => ` (${g.join(' and ')})`).join(', ')}. OBS doesn't support
        this — it will default to the first source added.
      </span>
    </div>
  )
}
