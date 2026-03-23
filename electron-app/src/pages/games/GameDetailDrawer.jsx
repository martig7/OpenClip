import { X, Trash2, Edit2, Plus } from 'lucide-react'
import EditGameModal from './EditGameModal'
import AudioSourcesCard from './AudioSourcesCard'
import { GameAvatar } from './GameAvatar'
import { GameEnabledBadge } from './GameEnabledBadge'
import { useSidebarResize, STORAGE_KEY_GAMES_DRAWER } from '../../hooks/useSidebarResize'

export function GameDetailDrawer({
  gameId,
  game,
  isEditing,
  sceneAudioSources,
  audioLoading,
  onClose,
  onDelete,
  onStartEdit,
  onCancelEdit,
  onSave,
  onChangeGame,
  editedGame,
  otherGameScenes,
  masterAudioSources,
  addSourceToScene,
  removeSourceFromScene,
  addMasterSource,
  trackData,
  trackLoading,
  trackLabels,
  toggleTrack,
  onCreateScene,
  creatingScene,
}) {
  const { sidebarWidth, handleMouseDown } = useSidebarResize(STORAGE_KEY_GAMES_DRAWER, {
    min: 450,
    max: 1200,
    defaultW: 500,
    side: 'right',
  })

  const drawerGame = isEditing && editedGame ? editedGame : game

  return (
    <div
      className={`game-detail-drawer ${gameId ? 'open' : ''}`}
      style={gameId ? { '--sidebar-width': `${sidebarWidth}px` } : undefined}
      aria-hidden={!gameId}
    >
      {gameId && game && (
        <div className="drawer-inner">
          <div
            className="sidebar-resizer drawer-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize game detail drawer"
            onMouseDown={handleMouseDown}
          />
          <div className="drawer-header">
            <GameAvatar game={drawerGame} size={40} />

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="drawer-name-row">
                <div className="drawer-name">{drawerGame.name}</div>
                <GameEnabledBadge enabled={drawerGame.enabled} />
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
                      <div className="drawer-info-label">Status</div>
                      <div className="drawer-info-val">
                        {drawerGame.enabled ? 'Active' : 'Off'}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="drawer-section">
                  <AudioSourcesCard
                    mode="scene"
                    sources={sceneAudioSources}
                    loading={audioLoading}
                    trackLabels={trackLabels}
                    trackData={trackData}
                    trackLoading={trackLoading}
                    onToggleTrack={toggleTrack}
                    onRemoveSource={removeSourceFromScene}
                    onAddSource={addSourceToScene}
                    game={drawerGame}
                    masterAudioSources={masterAudioSources}
                    onAddMasterSource={addMasterSource}
                    sceneName={drawerGame.scene}
                  />
                </section>

                {drawerGame.isAutoDetected && (
                  <section className="drawer-section">
                    <div className="drawer-section-title">Dedicated Scene</div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                      This game was auto-detected. Create a dedicated OBS scene to customize its sources and audio independently.
                    </p>
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      disabled={creatingScene}
                      onClick={() => onCreateScene(drawerGame)}
                    >
                      <Plus size={12} />
                      {creatingScene ? 'Creating…' : 'Create OBS Scene'}
                    </button>
                  </section>
                )}

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
            ) : editedGame ? (
              <EditGameModal
                variant="drawer"
                modal={{
                  game: editedGame,
                  sceneAudioSources,
                  loading: audioLoading,
                }}
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
            )}
          </div>
        </div>
      )}
    </div>
  )
}
