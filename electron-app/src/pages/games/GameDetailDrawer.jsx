import { X, Trash2, Edit2 } from 'lucide-react'
import EditGameModal from './EditGameModal'
import { SceneAudioSourcesSection } from './SceneAudioSourcesSection'

const GAME_PALETTE = [
  '#7c3aed',
  '#3b82f6',
  '#06b6d4',
  '#6366f1',
  '#8b5cf6',
  '#0ea5e9',
  '#a78bfa',
  '#818cf8',
  '#2dd4bf',
  '#c084fc',
  '#60a5fa',
  '#22d3ee',
  '#4f46e5',
  '#7e22ce',
  '#0284c7',
  '#0891b2',
]

function getColor(id) {
  const str = String(id || '')
  if (!str) return GAME_PALETTE[0]
  const sum = str.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return GAME_PALETTE[sum % GAME_PALETTE.length]
}

function GameAvatar({ game, size = 40 }) {
  const bg = getColor(game?.id)
  const letter = (game?.name || '?').trim().slice(0, 1).toUpperCase()

  if (game?.icon_path) {
    return (
      <img
        src={`localfile:///${game.icon_path.replace(/\\/g, '/')}`}
        alt=""
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          flexShrink: 0,
          borderRadius: 6,
        }}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
    )
  }

  return (
    <div className="drawer-avatar" style={{ width: size, height: size, background: bg }}>
      {letter}
    </div>
  )
}

export function GameDetailDrawer({
  gameId,
  game,
  editGameModal,
  onClose,
  onDelete,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onChangeGame,
  otherGameScenes,
  masterAudioSources,
  addSourceToScene,
  removeSourceFromScene,
  addMasterSource,
  trackData,
  trackLoading,
  trackLabels,
  toggleTrack,
}) {
  const drawerGame = editGameModal?.game || game

  const loading = editGameModal?.loading || (game?.scene ? true : false)
  const sceneAudioSources = editGameModal?.sceneAudioSources || []

  return (
    <div className={`game-detail-drawer ${gameId ? 'open' : ''}`} aria-hidden={!gameId}>
      {gameId && drawerGame && (
        <div className="drawer-inner">
          <div className="drawer-header">
            <GameAvatar game={drawerGame} />

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="drawer-name-row">
                <div className="drawer-name">{drawerGame.name}</div>
                <span
                  className={`badge ${drawerGame.enabled ? 'badge-success' : 'badge-muted'}`}
                >
                  <span
                    className="badge-dot"
                    style={{
                      background: drawerGame.enabled ? 'var(--success)' : 'var(--text-muted)',
                    }}
                  />
                  {drawerGame.enabled ? 'Active' : 'Off'}
                </span>
              </div>
              <div className="drawer-scene">{drawerGame.scene || '—'}</div>
            </div>

            <button
              className="btn-icon"
              type="button"
              onClick={onClose}
              title="Close drawer"
              style={{ marginLeft: 'auto' }}
            >
              <X size={15} />
            </button>
          </div>

          <div className="drawer-body">
            {!isEditing ? (
              <>
                <section className="drawer-section">
                  <div className="drawer-section-title">Configuration</div>

                  <div className="drawer-info-grid">
                    <div className="drawer-info-cell">
                      <div className="drawer-info-label">Selector</div>
                      <div
                        className="drawer-info-val"
                        style={{ fontFamily: 'monospace', fontSize: 11 }}
                      >
                        {drawerGame.selector || '—'}
                      </div>
                    </div>

                    <div className="drawer-info-cell">
                      <div className="drawer-info-label">Scene</div>
                      <div className="drawer-info-val">{drawerGame.scene || '—'}</div>
                    </div>

                    <div className="drawer-info-cell">
                      <div className="drawer-info-label">Clips</div>
                      <div className="drawer-info-val">{drawerGame.clips ?? '—'}</div>
                    </div>

                    <div className="drawer-info-cell">
                      <div className="drawer-info-label">Status</div>
                      <div className="drawer-info-val">
                        {drawerGame.enabled ? 'Active' : 'Off'}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="drawer-section">
                  <SceneAudioSourcesSection
                    game={drawerGame}
                    sceneAudioSources={sceneAudioSources}
                    loading={loading}
                    masterAudioSources={masterAudioSources}
                    onAddSourceToScene={addSourceToScene}
                    onRemoveSourceFromScene={removeSourceFromScene}
                    onAddMasterSource={addMasterSource}
                    trackData={trackData}
                    trackLoading={trackLoading}
                    toggleTrack={toggleTrack}
                    trackLabels={trackLabels}
                  />
                </section>

                <div className="drawer-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={() => onStartEdit(drawerGame)}
                  >
                    <Edit2 size={12} /> Edit Game
                  </button>

                  <button
                    className="btn-icon"
                    type="button"
                    onClick={() => {
                      onDelete(drawerGame.id)
                      onClose()
                    }}
                    title="Remove game"
                    style={{ color: 'var(--danger)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </>
            ) : (
              editGameModal ? (
                <EditGameModal
                  variant="drawer"
                  modal={editGameModal}
                  masterAudioSources={masterAudioSources}
                  otherGameScenes={otherGameScenes}
                  onChangeGame={onChangeGame}
                  onSave={onSave}
                  onClose={onCancelEdit}
                  onAddSourceToScene={addSourceToScene}
                  onRemoveSourceFromScene={removeSourceFromScene}
                  onAddMasterSource={addMasterSource}
                  trackData={trackData}
                  trackLoading={trackLoading}
                  toggleTrack={toggleTrack}
                  trackLabels={trackLabels}
                />
              ) : (
                <div style={{ paddingTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                  Loading…
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}

