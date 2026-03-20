import { Plus, Gamepad2 } from 'lucide-react'
import { GameList } from './GameList'
import SceneAudioSourcesCard from './SceneAudioSourcesCard'

export function GamesPageBody({
  games,
  openAddModal,
  toggleGame,
  openEditModal,
  removeGame,
  masterAudioSources,
  applyingSource,
  showAudioDropdown,
  setShowAudioDropdown,
  audioDropdownRef,
  availableAudioInputs,
  loadingAudioInputs,
  audioDropdownError,
  trackLabels,
  setTrackLabels,
  trackData,
  trackLoading,
  loadAudioInputsForDropdown,
  addMasterSource,
  removeMasterSource,
  toggleTrack,
  showToast,
}) {
  return (
    <div className="page-body">
      <div className="card">
        <div className="card-header">
          <span className="card-title">Game Library ({games.length})</span>
          <button className="btn btn-primary btn-sm" onClick={openAddModal}>
            <Plus size={14} /> Add Game
          </button>
        </div>

        {games.length === 0 ? (
          <div className="empty-state">
            <Gamepad2 size={40} />
            <p>No games added yet. Click "Add Game" to get started.</p>
          </div>
        ) : (
          <GameList
            games={games}
            toggleGame={toggleGame}
            openEditModal={openEditModal}
            removeGame={removeGame}
          />
        )}
      </div>

      <SceneAudioSourcesCard
        masterAudioSources={masterAudioSources}
        applyingSource={applyingSource}
        showAudioDropdown={showAudioDropdown}
        setShowAudioDropdown={setShowAudioDropdown}
        audioDropdownRef={audioDropdownRef}
        availableAudioInputs={availableAudioInputs}
        loadingAudioInputs={loadingAudioInputs}
        audioDropdownError={audioDropdownError}
        trackLabels={trackLabels}
        setTrackLabels={setTrackLabels}
        trackData={trackData}
        trackLoading={trackLoading}
        onLoadAudioInputs={loadAudioInputsForDropdown}
        onAddSource={addMasterSource}
        onRemoveSource={removeMasterSource}
        onToggleTrack={toggleTrack}
        showToast={showToast}
      />
    </div>
  )
}
