import { useState, useEffect } from 'react'
import {
  Plus,
  AlertTriangle,
  Gamepad2,
  Save,
} from 'lucide-react'
import api from '../../api'
import AudioSourcesCard from './AudioSourcesCard'
import WindowPicker from './WindowPicker'

/** Edit game fields, scene, and per-scene audio (modal or drawer). */
export default function EditGameModal({
  modal,
  masterAudioSources,
  otherGameScenes,
  onChangeGame,
  onSave,
  onClose,
  onAddSourceToScene,
  onRemoveSourceFromScene,
  onAddMasterSource,
  trackData,
  trackLoading,
  toggleTrack,
  trackLabels,
  variant = 'modal',
}) {
  const { game, sceneAudioSources, loading } = modal

  const isDuplicateScene = game.scene && otherGameScenes && otherGameScenes.has(game.scene)

  const [showWindowPicker, setShowWindowPicker] = useState(false)
  const [loadingWindows, setLoadingWindows] = useState(false)
  const [visibleWindows, setVisibleWindows] = useState([])

  useEffect(() => {
    ;(async () => {
      setLoadingWindows(true)
      try {
        const windows = await api.getVisibleWindows()
        setVisibleWindows(windows)
      } catch (err) {
        console.error('Failed to get visible windows:', err)
      } finally {
        setLoadingWindows(false)
      }
    })()
  }, [])

  const [editCapturePref, setEditCapturePref] = useState('game_capture')

  const modalBody = (
    <>
      <h2>Edit Game</h2>
      <p>Edit game details and manage audio sources for this scene.</p>

      {/* Name */}
      <div className="form-group">
        <label className="form-label">Game Name</label>
        <input
          className="form-input"
          value={game.name || ''}
          onChange={(e) => onChangeGame({ name: e.target.value })}
          placeholder="e.g. Valorant"
        />
      </div>

      {/* Selector */}
      <div className="form-group">
        <label className="form-label">Window Selector</label>
        <div className="form-input-row">
          <input
            className="form-input"
            value={game.selector || ''}
            onChange={(e) =>
              onChangeGame({ selector: e.target.value, exe: '', windowClass: '' })
            }
            placeholder="e.g. VALORANT or valorant.exe"
          />
          <WindowPicker
            showPicker={showWindowPicker}
            setShowPicker={setShowWindowPicker}
            visibleWindows={visibleWindows}
            loadingWindows={loadingWindows}
            onSelect={(win) => {
              onChangeGame({
                selector: win.title,
                exe: win.exe,
                windowClass: win.windowClass,
                windowMatchPriority:
                  game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0,
              })
            }}
          />
        </div>
        {game.selector && game.exe && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--primary)',
              marginTop: 4,
              display: 'block',
            }}
          >
            ✓ Exact match binding set: {game.exe}
          </span>
        )}
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginTop: 2,
            display: 'block',
          }}
        >
          {(() => {
            if (!game.exe) {
              return 'Window title or process name substring matched for auto-recording'
            }
            const priority = game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0
            if (priority === 2) {
              return (
                <>
                  Watcher detects by exact process name (<strong>{game.exe}</strong>), not window
                  title.
                </>
              )
            }
            if (priority === 1) {
              return (
                <>
                  Watcher matches window title first; if not found, it falls back to process name
                  (<strong>{game.exe}</strong>).
                </>
              )
            }
            return (
              <>
                Watcher matches window title. The exe binding (<strong>{game.exe}</strong>) is
                mainly used for OBS Application Audio Capture window selection.
              </>
            )
          })()}
        </span>
      </div>

      {/* Window Match Priority */}
      <div className="form-group">
        <label className="form-label">Window Match Priority</label>
        <select
          className="form-input"
          value={game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0}
          onChange={(e) => onChangeGame({ windowMatchPriority: parseInt(e.target.value, 10) })}
        >
          <option value={0}>Match title, otherwise find window of same type</option>
          <option value={1}>Match title, otherwise find window of same executable</option>
          <option value={2}>Match executable</option>
        </select>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginTop: 2,
            display: 'block',
          }}
        >
          Controls how the watcher detects this game and how OBS Application Audio Capture picks
          its window.
        </span>
        {(game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0) === 2 &&
          !game.exe && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--warning)',
                marginTop: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <AlertTriangle size={11} /> No executable bound — use the window picker to set one,
              or the watcher won't detect this game.
            </span>
          )}
      </div>

      {/* Scene */}
      <div className="form-group">
        <label className="form-label">
          OBS Scene <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <input
          className="form-input"
          value={game.scene || ''}
          onChange={(e) => onChangeGame({ scene: e.target.value })}
          placeholder="e.g. Gaming Scene (required)"
          style={isDuplicateScene ? { borderColor: '#f59e0b' } : {}}
          required
        />
        {isDuplicateScene && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 5,
              padding: '5px 9px',
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              color: '#f59e0b',
            }}
          >
            <AlertTriangle size={12} style={{ flexShrink: 0 }} />
            This scene is already assigned to another game. Both games will share it.
          </div>
        )}
      </div>

      {/* Video Capture Source */}
      {game.scene && (
        <div style={{ marginBottom: 16 }}>
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
            <Gamepad2 size={13} />
            Video Capture Source
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {[
              { key: 'game_capture', label: 'Game Capture' },
              { key: 'window_capture', label: 'Window Capture' },
            ].map(({ key, label }) => (
              <button
                key={key}
                className={`btn btn-sm ${
                  editCapturePref === key ? 'btn-primary' : 'btn-secondary'
                }`}
                style={{ flex: 1, fontSize: 11 }}
                onClick={() => setEditCapturePref(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
              {editCapturePref === 'game_capture'
                ? 'Best for games on Windows. Uses OBS Game Capture.'
                : 'Cross-platform. Uses OBS Window Capture.'}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              style={{ fontSize: 11, whiteSpace: 'nowrap' }}
              onClick={() => {
                const exeGuess =
                  game.exe ||
                  (game.selector.toLowerCase().endsWith('.exe')
                    ? game.selector
                    : `${game.selector}.exe`)
                const windowClassGuess = game.windowClass || game.selector
                const titleGuess = game.selector
                const windowStr =
                  game.exe && game.windowClass
                    ? `${titleGuess}:${windowClassGuess}:${exeGuess}`
                    : titleGuess
                const sourceSuffix =
                  editCapturePref === 'game_capture' ? 'Game Capture' : 'Window Capture'
                const inputSettings =
                  editCapturePref === 'game_capture'
                    ? { capture_mode: 'window', window: windowStr }
                    : { window: windowStr }
                onAddSourceToScene(game.scene, {
                  name: `${game.scene} - ${sourceSuffix}`,
                  kind: editCapturePref,
                  inputSettings,
                })
              }}
            >
              <Plus size={12} /> Add to scene
            </button>
          </div>
        </div>
      )}

      <AudioSourcesCard
        mode="scene"
        sources={sceneAudioSources}
        loading={loading}
        trackLabels={trackLabels}
        trackData={trackData}
        trackLoading={trackLoading}
        onToggleTrack={toggleTrack}
        onRemoveSource={onRemoveSourceFromScene}
        onAddSource={onAddSourceToScene}
        game={game}
        masterAudioSources={masterAudioSources}
        onAddMasterSource={onAddMasterSource}
        sceneName={game.scene}
      />

      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onSave}>
          <Save size={13} /> Save
        </button>
      </div>
    </>
  )

  if (variant === 'drawer') {
    return (
      <div className="edit-game-drawer-content">
        {modalBody}
      </div>
    )
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        {modalBody}
      </div>
    </div>
  )
}
