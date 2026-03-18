import { Plus, Gamepad2 } from 'lucide-react'
import WatcherStatusCard from './WatcherStatusCard'
import { GameList } from './GameList'
import SceneAudioSourcesCard from './SceneAudioSourcesCard'

export function GamesPageBody({
  watcherStatus,
  toggleWatcher,
  scriptWarning,
  handleDismissWarning,
  handleGoToSettings,
  handleOpenOBS,
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
      {/* Watcher Status Card */}
      <WatcherStatusCard
        status={watcherStatus}
        onToggle={toggleWatcher}
        scriptWarning={scriptWarning}
        onDismissWarning={handleDismissWarning}
        onGoToSettings={handleGoToSettings}
        onOpenOBS={handleOpenOBS}
      />

      <div className="card" style={{ marginTop: 16 }}>
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
