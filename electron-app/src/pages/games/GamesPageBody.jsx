import { useState, useMemo } from 'react'
import api from '../../api'
import AudioSourcesCard from './AudioSourcesCard'
import { GamesTable, GamesToolbar } from './GamesTable'
import { GameDetailDrawer } from './GameDetailDrawer'
import { ChevronDown } from 'lucide-react'
import { useGamesFilter } from '../../hooks/useGamesFilter'
import { useDrawerState } from '../../hooks/useDrawerState'
import { useSceneAudioMutations } from '../../hooks/useSceneAudioMutations'

/** `gamesAudioProps`: master audio + track UI state from GamesPage (`useMemo`). */
export function GamesPageBody({
  games,
  openAddModal,
  toggleGame,
  removeGame,
  saveGame,
  gamesAudioProps,
  fsConfig,
  onFsConfigChange,
  obsScenes,
  setObsScenes,
  showToast,
}) {
  const {
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
  } = gamesAudioProps

  const { filter, setFilter, search, setSearch, filtered, counts } = useGamesFilter(games)
  const {
    drawerGameId,
    selectedGame,
    isEditing,
    editedGame,
    changeDraftGame,
    enterEditMode,
    cancelEdit,
    sceneAudioSources,
    setSceneAudioSources,
    audioLoading,
    openDrawer,
    closeDrawer,
    stopEditing,
  } = useDrawerState(games)

  const { addSourceToScene, removeSourceFromScene } = useSceneAudioMutations({
    showToast,
    setSceneAudioSources,
  })

  const [audioExpanded, setAudioExpanded] = useState(false)
  const [creatingScene, setCreatingScene] = useState(false)

  const otherGameScenes = useMemo(() => {
    if (!selectedGame?.id) return new Set()
    return new Set(
      games
        .filter((g) => g.id !== selectedGame.id)
        .map((g) => g.scene)
        .filter(Boolean)
    )
  }, [games, selectedGame])

  async function handleCreateScene(game) {
    if (!fsConfig?.defaultScene) {
      showToast('Set a default scene before creating a dedicated one.')
      return
    }
    setCreatingScene(true)
    try {
      const result = await api.createOBSScene(game.name, fsConfig.defaultScene)
      if (result?.success) {
        await saveGame(game.id, { scene: game.name, isAutoDetected: false })
        showToast(`Scene "${game.name}" created.`)
      } else {
        showToast(result?.message || 'Could not create scene.')
      }
    } catch (err) {
      showToast(err?.message || 'Could not create scene.')
    } finally {
      setCreatingScene(false)
    }
  }

  async function handleSave() {
    if (!editedGame) return
    if (!editedGame.name || !editedGame.selector || !editedGame.scene) {
      showToast('Game name, window selector, and scene are required.')
      return
    }
    await saveGame(editedGame.id, {
      name: editedGame.name,
      selector: editedGame.selector,
      scene: editedGame.scene,
      exe: editedGame.exe,
      windowClass: editedGame.windowClass,
      windowMatchPriority: editedGame.windowMatchPriority,
      ...(editedGame.icon_path !== undefined ? { icon_path: editedGame.icon_path } : {}),
    })
    stopEditing()
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
            onRowClick={openDrawer}
            onToggle={toggleGame}
            onEdit={enterEditMode}
            onDelete={removeGame}
            fsConfig={fsConfig}
            onFsConfigChange={onFsConfigChange}
            obsScenes={obsScenes}
            setObsScenes={setObsScenes}
          />
        </div>

        <GameDetailDrawer
          gameId={drawerGameId}
          game={selectedGame}
          isEditing={isEditing}
          sceneAudioSources={sceneAudioSources}
          audioLoading={audioLoading}
          editedGame={editedGame}
          onClose={closeDrawer}
          onDelete={removeGame}
          onStartEdit={enterEditMode}
          onCancelEdit={cancelEdit}
          onSave={handleSave}
          onChangeGame={changeDraftGame}
          otherGameScenes={otherGameScenes}
          masterAudioSources={masterAudioSources}
          addSourceToScene={addSourceToScene}
          removeSourceFromScene={removeSourceFromScene}
          addMasterSource={addMasterSource}
          trackData={trackData}
          trackLoading={trackLoading}
          trackLabels={trackLabels}
          toggleTrack={toggleTrack}
          onCreateScene={handleCreateScene}
          creatingScene={creatingScene}
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
          <AudioSourcesCard
            mode="master"
            sources={masterAudioSources}
            loading={false}
            trackLabels={trackLabels}
            trackData={trackData}
            trackLoading={trackLoading}
            onToggleTrack={toggleTrack}
            onRemoveSource={removeMasterSource}
            showAudioDropdown={showAudioDropdown}
            setShowAudioDropdown={setShowAudioDropdown}
            audioDropdownRef={audioDropdownRef}
            availableAudioInputs={availableAudioInputs}
            loadingAudioInputs={loadingAudioInputs}
            audioDropdownError={audioDropdownError}
            onLoadAudioInputs={loadAudioInputsForDropdown}
            onAddSource={addMasterSource}
            setTrackLabels={setTrackLabels}
            showToast={showToast}
            applyingSource={applyingSource}
          />
        )}
      </div>
    </div>
  )
}
