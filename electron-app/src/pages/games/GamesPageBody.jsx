import { useEffect, useMemo, useState } from 'react'
import SceneAudioSourcesCard from './SceneAudioSourcesCard'
import { GamesTable, GamesToolbar } from './GamesTable'
import { GameDetailDrawer } from './GameDetailDrawer'
import { ChevronDown } from 'lucide-react'
import { useGamesFilter } from '../../hooks/useGamesFilter'

export function GamesPageBody({
  games,
  openAddModal,
  toggleGame,
  openEditModal,
  removeGame,
  editGameModal,
  closeEditModal,
  onChangeEditGame,
  onSaveEditGame,
  addSourceToScene,
  removeSourceFromScene,
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
  const { filter, setFilter, search, setSearch, filtered, counts } = useGamesFilter(games)

  const [drawerGameId, setDrawerGameId] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [audioExpanded, setAudioExpanded] = useState(false)

  const selectedGame = useMemo(() => {
    if (!drawerGameId) return null
    return games.find((g) => g.id === drawerGameId) || null
  }, [drawerGameId, games])

  useEffect(() => {
    // When Edit state is cleared (e.g. Save/Cancel), ensure drawer selection is also cleared.
    if (!editGameModal) {
      setIsEditing(false)
      setDrawerGameId(null)
    }
  }, [editGameModal])

  const otherGameScenes = useMemo(() => {
    if (!editGameModal?.game?.id) return new Set()
    return new Set(
      games
        .filter((g) => g.id !== editGameModal.game.id)
        .map((g) => g.scene)
        .filter(Boolean)
    )
  }, [games, editGameModal])

  function handleRowClick(game) {
    setDrawerGameId(game.id)
    setIsEditing(false)
    openEditModal(game)
  }

  function handleEditClick(game) {
    setDrawerGameId(game.id)
    setIsEditing(true)
    openEditModal(game)
  }

  function handleDrawerClose() {
    setIsEditing(false)
    closeEditModal()
    setDrawerGameId(null)
  }

  return (
    <div className="page-body games-page-layout">
      <GamesToolbar
        filter={filter}
        setFilter={setFilter}
        search={search}
        setSearch={setSearch}
        counts={counts}
        onAdd={openAddModal}
      />

      <div className="games-content">
        <div className="games-table-wrap">
          <GamesTable
            games={filtered}
            selectedId={drawerGameId}
            search={search}
            totalCount={counts.all}
            onClearSearch={() => setSearch('')}
            onAdd={openAddModal}
            onRowClick={handleRowClick}
            onToggle={toggleGame}
            onEdit={handleEditClick}
            onDelete={removeGame}
          />
        </div>

        <GameDetailDrawer
          gameId={drawerGameId}
          game={selectedGame}
          editGameModal={editGameModal}
          onClose={handleDrawerClose}
          onDelete={removeGame}
          isEditing={isEditing}
          onStartEdit={() => setIsEditing(true)}
          onCancelEdit={() => setIsEditing(false)}
          onSave={onSaveEditGame}
          onChangeGame={onChangeEditGame}
          otherGameScenes={otherGameScenes}
          masterAudioSources={masterAudioSources}
          addSourceToScene={addSourceToScene}
          removeSourceFromScene={removeSourceFromScene}
          addMasterSource={addMasterSource}
          trackData={trackData}
          trackLoading={trackLoading}
          trackLabels={trackLabels}
          toggleTrack={toggleTrack}
        />
      </div>

      <div className="games-audio-section">
        <button
          className="games-audio-toggle"
          type="button"
          onClick={() => setAudioExpanded((e) => !e)}
        >
          <span>Scene Audio Sources</span>
          <ChevronDown
            size={14}
            style={{
              transform: audioExpanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
            }}
          />
        </button>

        {audioExpanded && (
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
        )}
      </div>
    </div>
  )
}
