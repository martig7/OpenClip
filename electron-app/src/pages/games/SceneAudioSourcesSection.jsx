import { useState, useEffect, useRef } from 'react'
import { Plus, RefreshCw, Music, Trash2, AlertTriangle } from 'lucide-react'
import {
  AUDIO_KIND_META,
  AudioIcon,
  buildAvailableAudioInputs,
  getAppAudioWindowKey,
  isAppAudioKind,
} from './audioSourceUtils'

export function SceneAudioSourcesSection({
  game,
  sceneAudioSources,
  loading,
  masterAudioSources,
  onAddSourceToScene,
  onRemoveSourceFromScene,
  onAddMasterSource,
  trackData,
  trackLoading,
  toggleTrack,
  trackLabels,
}) {
  const masterNames = new Set(masterAudioSources.map((s) => s.name))

  // ── Feature 2: add-source dropdown (local to modal) ──────────────────────
  const [showModalAudioDropdown, setShowModalAudioDropdown] = useState(false)
  const [modalAudioInputs, setModalAudioInputs] = useState([])
  const [loadingModalAudio, setLoadingModalAudio] = useState(false)
  const [modalAudioError, setModalAudioError] = useState(null)
  const modalAudioDropdownRef = useRef(null)

  // Eagerly load data when the modal opens
  useEffect(() => {
    if (game.scene) {
      loadModalAudioInputs()
    }
  }, [])

  // Close modal audio dropdown on outside click
  useEffect(() => {
    if (!showModalAudioDropdown) return
    const handler = (e) => {
      if (modalAudioDropdownRef.current && !modalAudioDropdownRef.current.contains(e.target)) {
        setShowModalAudioDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModalAudioDropdown])

  async function loadModalAudioInputs() {
    setLoadingModalAudio(true)
    setModalAudioError(null)
    try {
      const combined = await buildAvailableAudioInputs()
      setModalAudioInputs(combined)
    } catch (err) {
      setModalAudioError(err.message || 'Failed to load audio sources')
    } finally {
      setLoadingModalAudio(false)
    }
  }

  // State for 'add from master' dropdown inside the modal
  const [addFromMaster, setAddFromMaster] = useState('')

  return (
    <div style={{ marginTop: 4, marginBottom: 16 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Music size={13} />
        Scene Audio Sources
        {game.scene && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
            — {game.scene}
          </span>
        )}
        {/* Feature 2: Add Source button in modal */}
        {game.scene && !loading && (
          <div style={{ marginLeft: 'auto', position: 'relative' }} ref={modalAudioDropdownRef}>
            <button
              className="btn btn-primary btn-sm"
              style={{ fontSize: 11, padding: '3px 9px' }}
              onClick={() => {
                if (!showModalAudioDropdown) {
                  setShowModalAudioDropdown(true)
                  loadModalAudioInputs()
                } else {
                  setShowModalAudioDropdown(false)
                }
              }}
            >
              <Plus size={12} /> Add Source
            </button>

            {showModalAudioDropdown && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  zIndex: 300,
                  minWidth: 280,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-light)',
                  borderRadius: 'var(--radius)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '7px 12px',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Add to Scene
                </div>
                {loadingModalAudio ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '11px 14px',
                      fontSize: 12,
                      color: 'var(--text-muted)',
                    }}
                  >
                    <RefreshCw size={12} className="spinning" /> Loading…
                  </div>
                ) : modalAudioError ? (
                  <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--danger)' }}>
                    {modalAudioError}
                  </div>
                ) : modalAudioInputs.length === 0 ? (
                  <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                    No audio sources found.
                  </div>
                ) : (
                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    {['obs', 'windows', 'app'].map((group) => {
                      const items = modalAudioInputs.filter((a) => a.source === group)
                      if (items.length === 0) return null
                      const groupLabel = {
                        obs: 'OBS Inputs',
                        windows: 'Windows Devices',
                        app: 'Applications',
                      }[group]
                      return (
                        <div key={group}>
                          <div
                            style={{
                              padding: '5px 12px 2px',
                              fontSize: 10,
                              color: 'var(--text-muted)',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              letterSpacing: '0.06em',
                              borderTop: group !== 'obs' ? '1px solid var(--border)' : 'none',
                              marginTop: group !== 'obs' ? 3 : 0,
                            }}
                          >
                            {groupLabel}
                          </div>
                          {items.map((entry, i) => {
                            const alreadyInScene = sceneAudioSources.some(
                              (s) =>
                                s.inputName === entry.name ||
                                (entry.kind === 'magic_game_audio' &&
                                  s.inputName.startsWith('Game Audio ('))
                            )
                            const meta = AUDIO_KIND_META[entry.kind]
                            return (
                              <button
                                key={i}
                                disabled={alreadyInScene}
                                onClick={() => {
                                  if (!alreadyInScene) {
                                    if (entry.kind === 'magic_game_audio') {
                                      const exeGuess =
                                        game.exe ||
                                        (game.selector.toLowerCase().endsWith('.exe')
                                          ? game.selector
                                          : `${game.selector}.exe`)
                                      const windowClassGuess = game.windowClass || game.selector
                                      const titleGuess = game.selector
                                      onAddSourceToScene(game.scene, {
                                        name: `Game Audio (${game.name})`,
                                        kind: 'wasapi_process_output_capture',
                                        inputSettings: {
                                          window: `${titleGuess}:${windowClassGuess}:${exeGuess}`,
                                          window_match_priority:
                                            game.windowMatchPriority !== undefined
                                              ? game.windowMatchPriority
                                              : 0,
                                        },
                                      })
                                    } else {
                                      onAddSourceToScene(game.scene, {
                                        name: entry.name,
                                        kind: entry.kind,
                                        inputSettings: entry.inputSettings || {},
                                      })
                                    }
                                    setShowModalAudioDropdown(false)
                                  }
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 9,
                                  width: '100%',
                                  padding: '6px 14px',
                                  background: 'none',
                                  border: 'none',
                                  cursor: alreadyInScene ? 'default' : 'pointer',
                                  textAlign: 'left',
                                  opacity: alreadyInScene ? 0.45 : 1,
                                }}
                                onMouseEnter={(e) => {
                                  if (!alreadyInScene)
                                    e.currentTarget.style.background = 'var(--bg-hover)'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = 'none'
                                }}
                              >
                                <AudioIcon kind={entry.kind} size={13} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: 12,
                                      color: 'var(--text-primary)',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {entry.name}
                                  </div>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                    {meta?.label || entry.kind}
                                  </div>
                                </div>
                                {alreadyInScene && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: 'var(--text-muted)',
                                      flexShrink: 0,
                                    }}
                                  >
                                    In scene
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {!game.scene ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
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
            padding: '8px 0',
          }}
        >
          <RefreshCw size={13} className="spinning" /> Loading scene audio sources…
        </div>
      ) : (
        <>
          {/* Warn if two Application Audio sources share the same window in this scene */}
          {(() => {
            const appSources = sceneAudioSources.filter((s) => isAppAudioKind(s.inputKind))
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
                  padding: '7px 10px',
                  marginBottom: 8,
                  background: 'rgba(245,158,11,0.10)',
                  border: '1px solid rgba(245,158,11,0.35)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  color: '#f59e0b',
                }}
              >
                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  This scene has two Application Audio sources targeting the same window
                  {duplicated.map((g) => ` (${g.join(' and ')})`).join(', ')}. OBS doesn't
                  support this — it will default to the first source added.
                </span>
              </div>
            )
          })()}

          {/* List of existing scene audio sources */}
          {sceneAudioSources.length === 0 ? (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                padding: '8px 10px',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              No audio sources found in this OBS scene. This may mean OBS is closed or the
              OpenClip plugin is not installed.
            </div>
          ) : (
            <div
              style={{
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                marginBottom: 10,
              }}
            >
              {/* Track label header row */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'flex-end',
                  padding: '5px 12px 2px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', gap: 5, marginRight: 32 }}>
                  {[1, 2, 3, 4, 5, 6].map((num) => (
                    <div
                      key={num}
                      style={{
                        width: 22,
                        textAlign: 'center',
                        fontSize: 9,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        lineHeight: 1,
                      }}
                    >
                      {trackLabels?.[num - 1] || `T${num}`}
                    </div>
                  ))}
                </div>
              </div>

              {sceneAudioSources.map((src, i) => {
                const isInMaster =
                  masterNames.has(src.inputName) ||
                  (src.inputName.startsWith('Game Audio (') && masterNames.has('Game Audio'))
                const meta = AUDIO_KIND_META[src.inputKind]
                const tracks = trackData[src.inputName] || {}
                const isTrackLoading = trackLoading[src.inputName]
                const displayName = src.inputName.startsWith('Game Audio (')
                  ? 'Game Audio'
                  : src.inputName
                return (
                  <div
                    key={i}
                    style={{
                      borderBottom:
                        i < sceneAudioSources.length - 1 ? '1px solid var(--border)' : 'none',
                      padding: '7px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <AudioIcon kind={src.inputKind} size={14} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {displayName}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {meta?.label || src.inputKind}
                      </div>
                    </div>
                    {!isInMaster && (
                      <button
                        type="button"
                        className="audio-source-not-master-pill"
                        onClick={() => onAddMasterSource({ name: src.inputName, kind: src.inputKind })}
                        title="Add to Master List"
                      >
                        <span>Not in master list</span>
                        <Plus className="audio-source-not-master-pill__icon" size={11} strokeWidth={2.5} aria-hidden />
                      </button>
                    )}

                    {/* Track routing chips — inline */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      {[1, 2, 3, 4, 5, 6].map((num) => {
                        const active = tracks[String(num)] === true
                        return (
                          <button
                            key={num}
                            title={`${trackLabels?.[num - 1] || `Track ${num}`}: ${active ? 'active' : 'inactive'}`}
                            disabled={isTrackLoading}
                            onClick={() => toggleTrack(src.inputName, num)}
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 4,
                              border: active
                                ? '1.5px solid var(--primary)'
                                : '1.5px solid var(--border-light)',
                              background: active ? 'var(--primary)' : 'var(--bg-secondary)',
                              color: active ? '#fff' : 'var(--text-muted)',
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: isTrackLoading ? 'default' : 'pointer',
                              opacity: isTrackLoading ? 0.6 : 1,
                              transition: 'background 0.12s, border-color 0.12s, color 0.12s',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              lineHeight: 1,
                            }}
                          >
                            {num}
                          </button>
                        )
                      })}
                      {isTrackLoading && (
                        <RefreshCw
                          size={11}
                          className="spinning"
                          style={{ color: 'var(--text-muted)' }}
                        />
                      )}
                    </div>

                    <button
                      className="btn-icon"
                      onClick={() => onRemoveSourceFromScene(game.scene, src.inputName)}
                      title="Remove from scene"
                      style={{ color: 'var(--danger)', flexShrink: 0 }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Add from master list */}
          {masterAudioSources.length > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                      !sceneAudioSources.some(
                        (sc) =>
                          sc.inputName === s.name ||
                          (s.kind === 'magic_game_audio' &&
                            sc.inputName.startsWith('Game Audio ('))
                      )
                  )
                  .map((s, i) => (
                    <option key={i} value={s.name}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <button
                className="btn btn-secondary btn-sm"
                disabled={!addFromMaster}
                onClick={() => {
                  const src = masterAudioSources.find((s) => s.name === addFromMaster)
                  if (src) {
                    if (src.kind === 'magic_game_audio') {
                      const exeGuess =
                        game.exe ||
                        (game.selector.toLowerCase().endsWith('.exe')
                          ? game.selector
                          : `${game.selector}.exe`)
                      const windowClassGuess = game.windowClass || game.selector
                      const titleGuess = game.selector
                      onAddSourceToScene(game.scene, {
                        name: `Game Audio (${game.name})`,
                        kind: 'wasapi_process_output_capture',
                        inputSettings: {
                          window: `${titleGuess}:${windowClassGuess}:${exeGuess}`,
                          window_match_priority:
                            game.windowMatchPriority !== undefined
                              ? game.windowMatchPriority
                              : 0,
                        },
                      })
                    } else {
                      onAddSourceToScene(game.scene, {
                        name: src.name,
                        kind: src.kind,
                        inputSettings: src.inputSettings || {},
                      })
                    }
                    setAddFromMaster('')
                  }
                }}
              >
                <Plus size={13} /> Add
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
