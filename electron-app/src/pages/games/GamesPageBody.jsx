import { useState, useMemo } from 'react'
import AudioSourcesCard from './AudioSourcesCard'
import { GamesTable, GamesToolbar } from './GamesTable'
import { GameDetailDrawer } from './GameDetailDrawer'
import { ChevronDown } from 'lucide-react'
import { useGamesFilter } from '../../hooks/useGamesFilter'
import { useDrawerState } from '../../hooks/useDrawerState'
import api from '../../api'
import {
  getAppAudioWindowKey,
  isAppAudioKind,
} from './audioSourceUtils'

export function GamesPageBody({
  games,
  openAddModal,
  toggleGame,
  removeGame,
  saveGame,
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
  const drawer = useDrawerState(games)

  const [editedGame, setEditedGame] = useState(null)
  const [audioExpanded, setAudioExpanded] = useState(false)

  const otherGameScenes = useMemo(() => {
    if (!drawer.selectedGame?.id) return new Set()
    return new Set(
      games
        .filter((g) => g.id !== drawer.selectedGame.id)
        .map((g) => g.scene)
        .filter(Boolean)
    )
  }, [games, drawer.selectedGame])

  function handleRowClick(game) {
    drawer.openDrawer(game)
  }

  function handleEditClick(game) {
    setEditedGame({ ...game })
    drawer.openDrawerEditing(game)
  }

  function handleStartEdit(game) {
    setEditedGame({ ...game })
    drawer.startEditing()
  }

  function handleCancelEdit() {
    setEditedGame(null)
    drawer.stopEditing()
  }

  function handleDrawerClose() {
    setEditedGame(null)
    drawer.closeDrawer()
  }

  function handleChangeGame(updates) {
    setEditedGame((prev) => (prev ? { ...prev, ...updates } : null))
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
    setEditedGame(null)
    drawer.stopEditing()
  }

  async function addSourceToScene(sceneName, source) {
    if (!sceneName) return
    try {
      const isVideoCapture = source.kind === 'game_capture' || source.kind === 'window_capture'
      const result = await api.addAudioSourceToScenes(
        [sceneName],
        source.kind,
        source.name,
        source.inputSettings || {},
        isVideoCapture ? { fitToCanvas: true } : {}
      )
      if (result.success) {
        if (isVideoCapture) {
          showToast(`"${source.name}" added to scene`)
        } else {
          let conflictWarning = null
          drawer.setSceneAudioSources((prev) => {
            const already = prev.some((s) => s.inputName === source.name)
            if (already) return prev
            if (isAppAudioKind(source.kind)) {
              const newKey = getAppAudioWindowKey(source.name, source.inputSettings?.window)
              const duplicate = prev.find(
                (s) =>
                  isAppAudioKind(s.inputKind) &&
                  getAppAudioWindowKey(s.inputName, s.inputSettings?.window) === newKey
              )
              if (duplicate) conflictWarning = duplicate.inputName
            }
            return [
              ...prev,
              {
                inputName: source.name,
                inputKind: source.kind,
                inputSettings: source.inputSettings || {},
              },
            ]
          })
          if (conflictWarning) {
            showToast(
              `OBS doesn't support two Application Audio sources for the same window — OBS will default to "${conflictWarning}" (the first source added).`
            )
          } else {
            showToast(`"${source.name}" added to scene`)
          }
        }
      } else {
        showToast(`Warning: ${result.message}`)
      }
    } catch (err) {
      showToast(`Failed: ${err.message}`)
    }
  }

  async function removeSourceFromScene(sceneName, inputName) {
    if (!sceneName) return
    try {
      const result = await api.removeAudioSourceFromScenes([sceneName], inputName)
      if (result.success) {
        drawer.setSceneAudioSources((prev) =>
          prev.filter((s) => s.inputName !== inputName)
        )
        showToast(`"${inputName}" removed from scene`)
      } else {
        showToast(`Warning: ${result.message}`)
      }
    } catch (err) {
      showToast(`Failed: ${err.message}`)
    }
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
            selectedId={drawer.drawerGameId}
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
          gameId={drawer.drawerGameId}
          game={drawer.selectedGame}
          isEditing={drawer.isEditing}
          sceneAudioSources={drawer.sceneAudioSources}
          audioLoading={drawer.audioLoading}
          editedGame={editedGame}
          onClose={handleDrawerClose}
          onDelete={removeGame}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onSave={handleSave}
          onChangeGame={handleChangeGame}
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
