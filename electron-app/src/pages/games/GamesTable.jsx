import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Search, Edit2, Trash2, Gamepad2, Monitor, ChevronDown } from 'lucide-react'
import { GameAvatar } from './GameAvatar'
import { GameEnabledBadge } from './GameEnabledBadge'
import api from '../../api'
import {
  useSidebarResize,
  STORAGE_KEY_GAMES_CAPTION_CLUSTER,
} from '../../hooks/useSidebarResize'

export function GamesToolbar({ filter, setFilter, search, setSearch, counts, onAdd }) {
  const { sidebarWidth: captionClusterMaxPx, handleMouseDown: onCaptionClusterResizeMouseDown } =
    useSidebarResize(STORAGE_KEY_GAMES_CAPTION_CLUSTER, {
      min: 260,
      max: 920,
      defaultW: 480,
    })

  return (
    <div className="games-toolbar">
      <header className="games-caption-bar" aria-label="Games">
        <div
          className="games-caption-bar__cluster"
          style={{ maxWidth: captionClusterMaxPx }}
        >
          <div className="msb-row1 games-caption-bar__row">
            <span className="msb-title">Games</span>
            <div className="msb-search">
              <span className="msb-search-icon" aria-hidden>
                <Search size={11} />
              </span>
              <input
                type="search"
                placeholder="Search games…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div
            className="games-caption-bar__resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Games search section"
            onMouseDown={onCaptionClusterResizeMouseDown}
          />
        </div>
        <div className="games-caption-bar__drag-fill" aria-hidden />
      </header>

      <div className="main-content-topbar-rule games-toolbar-top-rule" aria-hidden />

      <div className="games-toolbar-actions">
        <div className="msb-game-filter" aria-label="Game filter">
          {[
            { key: 'all', label: 'All', count: counts.all },
            { key: 'enabled', label: 'Enabled', count: counts.enabled },
            { key: 'disabled', label: 'Disabled', count: counts.disabled },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              className={`msb-game-pill${filter === t.key ? ' active' : ''}`}
              onClick={() => setFilter(t.key)}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        <button className="games-add-btn" type="button" onClick={onAdd}>
          <Plus size={13} /> Add Game
        </button>
      </div>
    </div>
  )
}

/** Scene picker used in the "Any Fullscreen App" row. Dropdown is rendered via a
 *  portal to avoid clipping by `overflow-y: auto` on the table scroll container. */
export function FullscreenScenePicker({ currentScene, onSelect, onCreateScene }) {
  const [open, setOpen] = useState(false)
  const [scenes, setScenes] = useState([])
  const [loading, setLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createMode, setCreateMode] = useState('scratch')
  const [templateScene, setTemplateScene] = useState('')
  const [applyMasterAudioSources, setApplyMasterAudioSources] = useState(true)
  const [newSceneName, setNewSceneName] = useState('')
  const [createError, setCreateError] = useState('')
  const [creatingScene, setCreatingScene] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const dropdownRef = useRef(null)

  async function loadScenes() {
    setLoading(true)
    try {
      const fetchedScenes = await api.getOBSWSScenes()
      setScenes(Array.isArray(fetchedScenes) ? fetchedScenes : [])
    } catch {
      setScenes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    loadScenes()
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleToggle(e) {
    e.stopPropagation()
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen((o) => !o)
  }

  async function handleCreate() {
    const name = newSceneName.trim()
    if (!name) return
    setCreateError('')
    setCreatingScene(true)
    const result =
      onCreateScene
        ? await onCreateScene({
            sceneName: name,
            createMode,
            templateScene,
            applyMasterAudioSources,
          }).catch((err) => ({ success: false, message: err.message }))
        : createMode === 'scratch'
          ? await api
              .createOBSSceneFromScratch(name, {
                addWindowCapture: true,
                captureKind: 'game_capture',
              })
              .catch((err) => ({
                success: false,
                message: err.message,
              }))
          : await api.createOBSScene(name, templateScene || null).catch((err) => ({
              success: false,
              message: err.message,
            }))
    setCreatingScene(false)
    if (result?.success === false) {
      setCreateError(result.message || 'Could not create scene.')
      return
    }
    onSelect(name)
    setShowCreateModal(false)
    setNewSceneName('')
    setCreateMode('scratch')
    setTemplateScene('')
  }

  const dropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          className="fs-scene-picker__dropdown"
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left }}
        >
          <div className="fs-scene-picker__list">
            {loading && <div className="fs-scene-picker__empty">Loading scenes…</div>}
            {!loading && scenes.length === 0 && (
              <div className="fs-scene-picker__empty">No OBS scenes found</div>
            )}
            {scenes.map((scene) => {
              const name = typeof scene === 'string' ? scene : scene.sceneName
              return (
                <button
                  key={name}
                  type="button"
                  className={`fs-scene-picker__item${name === currentScene ? ' active' : ''}`}
                  onClick={() => {
                    onSelect(name)
                    setOpen(false)
                  }}
                >
                  {name}
                </button>
              )
            })}
          </div>
          <div className="fs-scene-picker__footer">
            <button
              type="button"
              className="fs-scene-picker__create-btn"
              onClick={() => {
                setOpen(false)
                setShowCreateModal(true)
                setCreateError('')
                setCreateMode('scratch')
                setTemplateScene('')
                setApplyMasterAudioSources(true)
              }}
            >
              <Plus size={11} /> Create new scene…
            </button>
          </div>
        </div>,
        document.body
      )
    : null

  return (
    <>
      <div className="fs-scene-picker">
        <button
          ref={triggerRef}
          type="button"
          className="fs-scene-picker__trigger"
          onClick={handleToggle}
          title="Choose default scene"
        >
          <span className={currentScene ? undefined : 'fs-scene-picker__placeholder'}>
            {currentScene || 'No scene set'}
          </span>
          <ChevronDown size={11} />
        </button>
        {dropdown}
      </div>

      {showCreateModal && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowCreateModal(false)
              setCreateError('')
            }
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create OBS Scene</h2>
            <p>Create a new scene for fullscreen recording.</p>

            <div className="form-group">
              <label className="form-label">Scene name</label>
              <input
                autoFocus
                className="form-input"
                placeholder="e.g. Fullscreen Scene"
                value={newSceneName}
                onChange={(e) => setNewSceneName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  className={`btn btn-sm ${createMode === 'scratch' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setCreateMode('scratch')}
                  style={{ flex: 1 }}
                >
                  Build from scratch
                </button>
                <button
                  className={`btn btn-sm ${createMode === 'template' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => {
                    setCreateMode('template')
                    if (scenes.length === 0) loadScenes()
                  }}
                  style={{ flex: 1 }}
                >
                  Copy from template
                </button>
              </div>

              {createMode === 'scratch' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 500 }}>Source type:</span> Game Capture
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Mode:</span>{' '}
                    Capture any fullscreen application
                  </div>
                </div>
              )}

              {createMode === 'template' && (
                <div>
                  <label className="form-label">Template scene (optional)</label>
                  <select
                    className="form-input"
                    value={templateScene}
                    onChange={(e) => setTemplateScene(e.target.value)}
                  >
                    <option value="">- Create empty scene -</option>
                    {scenes.map((scene) => {
                      const name = typeof scene === 'string' ? scene : scene.sceneName
                      return (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      )
                    })}
                  </select>
                </div>
              )}

              <div style={{ marginTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={applyMasterAudioSources}
                    onChange={(e) => setApplyMasterAudioSources(e.target.checked)}
                  />
                  Apply master audio sources after scene creation
                </label>
              </div>
            </div>

            {createError && (
              <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>
                {createError}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowCreateModal(false)
                  setCreateError('')
                }}
                disabled={creatingScene}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!newSceneName.trim() || creatingScene}
              >
                {creatingScene ? 'Creating...' : 'Create scene'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export function GamesTable({
  games,
  selectedId,
  search,
  totalCount,
  onClearSearch,
  onAdd,
  onRowClick,
  onToggle,
  onEdit,
  onDelete,
  fsConfig,
  onFsConfigChange,
  onFullscreenRowClick,
  fsDrawerOpen,
  onCreateFullscreenScene,
}) {
  const cols = 6

  return (
    <table className="games-table">
      <thead className="games-table-thead">
        <tr>
          <th className="col-toggle" aria-label="Enabled toggle" />
          <th className="col-icon" aria-label="Game icon" />
          <th>Name</th>
          <th>Scene</th>
          <th className="col-status">Status</th>
          <th className="col-actions" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {/* Pinned catch-all row — always visible regardless of filter/search */}
        {fsConfig && (
          <tr
            className={`games-table-fullscreen-row${fsConfig.enabled ? ' is-enabled' : ''}${fsDrawerOpen ? ' selected' : ''}`}
          >
            <td className="col-toggle">
              <button
                className={`toggle ${fsConfig.enabled ? 'on' : ''}`}
                type="button"
                title={fsConfig.enabled ? 'Fullscreen recording on' : 'Fullscreen recording off'}
                onClick={(e) => { e.stopPropagation(); onFsConfigChange({ ...fsConfig, enabled: !fsConfig.enabled }) }}
              />
            </td>
            <td className="col-icon">
              <Monitor size={18} style={{ color: 'var(--text-muted)', display: 'block' }} />
            </td>
            <td className="games-table-name" style={{ color: 'var(--text-muted)' }}>
              Any Fullscreen App
            </td>
            <td className="games-table-scene" onClick={(e) => e.stopPropagation()}>
              <FullscreenScenePicker
                currentScene={fsConfig.defaultScene}
                onSelect={(scene) => onFsConfigChange({ ...fsConfig, defaultScene: scene })}
                onCreateScene={onCreateFullscreenScene}
              />
            </td>
            <td className="col-status" />
            <td className="col-actions">
              <div className="games-table-actions">
                <button
                  className="btn-icon"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onFullscreenRowClick?.()
                  }}
                  title="Edit fullscreen config"
                  aria-label="Edit fullscreen config"
                >
                  <Edit2 size={14} />
                </button>
                <span
                  className="btn-icon"
                  aria-hidden
                  style={{ visibility: 'hidden', pointerEvents: 'none' }}
                >
                  <Trash2 size={14} />
                </span>
              </div>
            </td>
          </tr>
        )}

        {games.length === 0 ? (
          <tr>
            <td colSpan={cols}>
              <div className="empty-state">
                <Gamepad2 size={32} />
                <p>
                  {totalCount === 0
                    ? 'No games added yet. Click "Add Game" to get started.'
                    : search
                      ? 'No games match your search.'
                      : 'No games match your filter.'}
                </p>
                {totalCount === 0 ? (
                  <button className="btn btn-primary btn-sm" type="button" onClick={onAdd}>
                    Add your first game
                  </button>
                ) : search ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={onClearSearch}
                  >
                    Clear search
                  </button>
                ) : null}
              </div>
            </td>
          </tr>
        ) : (
          <>
            {games.map((game) => {
              const selected = selectedId === game.id
              const disabled = !game.enabled

              return (
                <tr
                  key={game.id}
                  className={`${selected ? 'selected' : ''} ${disabled ? 'is-disabled' : ''}`}
                  onClick={() => onRowClick(game)}
                >
                  <td className="col-toggle">
                    <button
                      className={`toggle ${game.enabled ? 'on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggle(game.id)
                      }}
                      title={game.enabled ? 'Enabled' : 'Disabled'}
                      type="button"
                    />
                  </td>

                  <td className="col-icon">
                    <GameAvatar game={game} size={28} />
                  </td>

                  <td className="games-table-name">
                    {game.name}
                    {game.isAutoDetected && (
                      <span className="game-default-pill">Default</span>
                    )}
                  </td>
                  <td className="games-table-scene">{game.scene || '—'}</td>

                  <td className="col-status">
                    <GameEnabledBadge enabled={game.enabled} />
                  </td>

                  <td className="col-actions">
                    <div className="games-table-actions">
                      <button
                        className="btn-icon"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onEdit(game)
                        }}
                        title="Edit game"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        className="btn-icon"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(game.id)
                        }}
                        title="Remove game"
                        style={{ color: 'var(--danger)' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            <tr className="games-table-add-row" key="games-table-add-slot">
              <td colSpan={cols}>
                <div className="games-table-add-slot">
                  <button
                    type="button"
                    className="games-add-circle-btn"
                    onClick={() => onAdd()}
                    aria-label="Add game"
                    title="Add game"
                  >
                    <Plus size={18} strokeWidth={2.25} aria-hidden />
                  </button>
                </div>
              </td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  )
}
