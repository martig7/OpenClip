import { useState, useMemo, useEffect, useCallback } from 'react'
import api from '../../api'
import AudioSourcesCard from './AudioSourcesCard'
import { GamesTable, GamesToolbar } from './GamesTable'
import { GameDetailDrawer } from './GameDetailDrawer'
import { ChevronDown } from 'lucide-react'
import { useGamesFilter } from '../../hooks/useGamesFilter'
import { useDrawerState } from '../../hooks/useDrawerState'
import { useSceneAudioMutations } from '../../hooks/useSceneAudioMutations'
import {
  FULLSCREEN_GAME_AUDIO_PREFIX,
  fullscreenManagedGameAudioInputName,
} from './audioSourceUtils'

export function GamesPageBody({
  games,
  openAddModal,
  toggleGame,
  removeGame,
  saveGame,
  gamesAudioProps,
  fsConfig,
  onFsConfigChange,
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

  const [fsDrawerOpen, setFsDrawerOpen] = useState(false)
  const [fsSceneAudioSources, setFsSceneAudioSources] = useState([])
  const [fsAudioLoading, setFsAudioLoading] = useState(false)

  const { addSourceToScene, removeSourceFromScene } = useSceneAudioMutations({
    showToast,
    setSceneAudioSources,
  })
  const { addSourceToScene: addFsSource, removeSourceFromScene: removeFsSource } =
    useSceneAudioMutations({ showToast, setSceneAudioSources: setFsSceneAudioSources })

  const [audioExpanded, setAudioExpanded] = useState(false)
  const [creatingScene, setCreatingScene] = useState(false)
  const [applyMasterOnCreateScene, setApplyMasterOnCreateScene] = useState(true)

  const fsSceneAudioSourcesForDisplay = useMemo(() => {
    const hasManagedGameAudio = fsSceneAudioSources.some((s) =>
      (s.inputName || '').startsWith(FULLSCREEN_GAME_AUDIO_PREFIX)
    )
    if (fsConfig?.gameAudioEnabled && !hasManagedGameAudio) {
      const anchor = games.find(
        (g) =>
          g.isAutoDetected &&
          g.scene === fsConfig?.defaultScene &&
          (g.exe || g.name)
      )
      const syntheticName = anchor
        ? fullscreenManagedGameAudioInputName(anchor)
        : null
      if (syntheticName) {
        return [
          ...fsSceneAudioSources,
          { inputName: syntheticName, inputKind: 'wasapi_process_output_capture' },
        ]
      }
      return [...fsSceneAudioSources, { inputName: 'Game Audio', inputKind: 'magic_game_audio' }]
    }
    return fsSceneAudioSources
  }, [fsSceneAudioSources, fsConfig?.defaultScene, fsConfig?.gameAudioEnabled, games])

  const isSelectedGameOnFullscreenDefault =
    !!selectedGame &&
    !!selectedGame.isAutoDetected &&
    !!selectedGame.scene &&
    selectedGame.scene === fsConfig?.defaultScene

  const sceneAudioSourcesForDisplay = useMemo(() => {
    const hasManagedGameAudio = sceneAudioSources.some((s) =>
      (s.inputName || '').startsWith(FULLSCREEN_GAME_AUDIO_PREFIX)
    )
    if (isSelectedGameOnFullscreenDefault && fsConfig?.gameAudioEnabled && !hasManagedGameAudio && selectedGame) {
      const syntheticName = fullscreenManagedGameAudioInputName(selectedGame)
      return [
        ...sceneAudioSources,
        { inputName: syntheticName, inputKind: 'wasapi_process_output_capture' },
      ]
    }
    return sceneAudioSources
  }, [
    sceneAudioSources,
    isSelectedGameOnFullscreenDefault,
    fsConfig?.gameAudioEnabled,
    selectedGame,
  ])

  const loadFsSceneAudio = useCallback(async (sceneName) => {
    if (!sceneName) { setFsSceneAudioSources([]); return }
    setFsAudioLoading(true)
    try {
      setFsSceneAudioSources((await api.getSceneAudioSources(sceneName)) || [])
    } catch {
      setFsSceneAudioSources([])
    } finally {
      setFsAudioLoading(false)
    }
  }, [])

  const openFsDrawer = useCallback(() => {
    closeDrawer()           // close any game drawer first
    setFsDrawerOpen(true)
    loadFsSceneAudio(fsConfig?.defaultScene)
  }, [closeDrawer, fsConfig, loadFsSceneAudio])

  const closeFsDrawer = useCallback(() => {
    setFsDrawerOpen(false)
    setFsSceneAudioSources([])
  }, [])

  useEffect(() => {
    if (fsDrawerOpen) loadFsSceneAudio(fsConfig?.defaultScene)
  }, [fsDrawerOpen, fsConfig?.defaultScene, loadFsSceneAudio])

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
        const shouldInheritFullscreenGameAudio =
          game.scene === fsConfig?.defaultScene && fsConfig?.gameAudioEnabled
        if (applyMasterOnCreateScene && masterAudioSources.length > 0) {
          await Promise.all(
            masterAudioSources.map((source) => {
              if (source.kind === 'magic_game_audio') {
                const exeGuess =
                  game.exe ||
                  (game.selector?.toLowerCase().endsWith('.exe')
                    ? game.selector
                    : `${game.selector || ''}.exe`)
                const windowClassGuess = game.windowClass || game.selector || ''
                const titleGuess = game.selector || ''
                return api
                  .addAudioSourceToScenes(
                    [game.name],
                    'wasapi_process_output_capture',
                    `Game Audio (${game.name})`,
                    {
                      window: `${titleGuess}:${windowClassGuess}:${exeGuess}`,
                      window_match_priority: game.windowMatchPriority ?? 0,
                    }
                  )
                  .catch(() => {})
              }
              return api
                .addAudioSourceToScenes(
                  [game.name],
                  source.kind,
                  source.name,
                  source.inputSettings || {}
                )
                .catch(() => {})
            })
          )
          await Promise.all(
            masterAudioSources.map((source) => {
              const masterKey = source.kind === 'magic_game_audio' ? 'Game Audio' : source.name
              const tracks = trackData[masterKey]
              if (!tracks || Object.keys(tracks).length === 0) return Promise.resolve()
              const obsInputName =
                source.kind === 'magic_game_audio' ? `Game Audio (${game.name})` : source.name
              return api.setInputAudioTracks(obsInputName, tracks).catch(() => {})
            })
          )
        }
        if (
          shouldInheritFullscreenGameAudio &&
          !masterAudioSources.some((s) => s.kind === 'magic_game_audio')
        ) {
          const exeGuess =
            game.exe ||
            (game.selector?.toLowerCase().endsWith('.exe')
              ? game.selector
              : `${game.selector || ''}.exe`)
          const windowClassGuess = game.windowClass || game.selector || ''
          const titleGuess = game.selector || ''
          await api
            .addAudioSourceToScenes(
              [game.name],
              'wasapi_process_output_capture',
              `Game Audio (${game.name})`,
              {
                window: `${titleGuess}:${windowClassGuess}:${exeGuess}`,
                window_match_priority: game.windowMatchPriority ?? 0,
              }
            )
            .catch(() => {})
          const parentFsInput = fullscreenManagedGameAudioInputName(game)
          const inheritedTracks =
            trackData[parentFsInput] ||
            trackData['Game Audio']
          if (inheritedTracks && Object.keys(inheritedTracks).length > 0) {
            await api
              .setInputAudioTracks(`Game Audio (${game.name})`, inheritedTracks)
              .catch(() => {})
          }
        }
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

  async function handleCreateFullscreenScene({
    sceneName,
    createMode,
    templateScene,
    applyMasterAudioSources,
  }) {
    if (!sceneName) return { success: false, message: 'Scene name is required.' }
    let result
    if (createMode === 'scratch') {
      result = await api.createOBSSceneFromScratch(sceneName, {
        addWindowCapture: true,
        captureKind: 'game_capture',
      })
    } else {
      result = await api.createOBSScene(sceneName, templateScene || null)
    }
    if (!result?.success) return result || { success: false, message: 'Could not create scene.' }

    if (applyMasterAudioSources && masterAudioSources.length > 0) {
      await Promise.all(
        masterAudioSources
          .filter((source) => source.kind !== 'magic_game_audio')
          .map((source) =>
            api
              .addAudioSourceToScenes([sceneName], source.kind, source.name, source.inputSettings || {})
              .catch(() => {})
          )
      )
      await Promise.all(
        masterAudioSources
          .filter((source) => source.kind !== 'magic_game_audio')
          .map((source) => {
            const tracks = trackData[source.name]
            if (!tracks || Object.keys(tracks).length === 0) return Promise.resolve()
            return api.setInputAudioTracks(source.name, tracks).catch(() => {})
          })
      )
    }

    return { success: true, message: result.message }
  }

  async function handleAddFsSource(sceneName, source) {
    if (source?.kind === 'magic_game_audio') {
      await onFsConfigChange({ ...fsConfig, gameAudioEnabled: true })
      showToast('Fullscreen Game Audio enabled.')
      return
    }
    await addFsSource(sceneName, source)
  }

  async function handleRemoveFsSource(sceneName, inputName) {
    const isFullscreenGameAudio =
      inputName === 'Game Audio' || (inputName || '').startsWith('Game Audio (Fullscreen')
    if (isFullscreenGameAudio) {
      const toRemove = fsSceneAudioSources
        .map((s) => s.inputName)
        .filter((name) => (name || '').startsWith('Game Audio (Fullscreen'))
      await Promise.all(
        toRemove.map((name) =>
          api.removeAudioSourceFromScenes([sceneName], name).catch(() => {})
        )
      )
      setFsSceneAudioSources((prev) =>
        prev.filter((s) => !(s.inputName || '').startsWith('Game Audio (Fullscreen'))
      )
      await onFsConfigChange({ ...fsConfig, gameAudioEnabled: false })
      showToast('Fullscreen Game Audio disabled.')
      return
    }
    await removeFsSource(sceneName, inputName)
  }

  async function handleAddSourceForSelectedGame(sceneName, source) {
    if (
      isSelectedGameOnFullscreenDefault &&
      sceneName === fsConfig?.defaultScene &&
      source?.kind === 'magic_game_audio'
    ) {
      await onFsConfigChange({ ...fsConfig, gameAudioEnabled: true })
      showToast('Fullscreen Game Audio enabled.')
      return
    }
    await addSourceToScene(sceneName, source)
  }

  async function handleRemoveSourceForSelectedGame(sceneName, inputName) {
    const isFullscreenGameAudio =
      inputName === 'Game Audio' || (inputName || '').startsWith('Game Audio (Fullscreen')
    if (isSelectedGameOnFullscreenDefault && sceneName === fsConfig?.defaultScene && isFullscreenGameAudio) {
      const toRemove = sceneAudioSources
        .map((s) => s.inputName)
        .filter((name) => (name || '').startsWith('Game Audio (Fullscreen'))
      await Promise.all(
        toRemove.map((name) =>
          api.removeAudioSourceFromScenes([sceneName], name).catch(() => {})
        )
      )
      setSceneAudioSources((prev) =>
        prev.filter((s) => !(s.inputName || '').startsWith('Game Audio (Fullscreen'))
      )
      await onFsConfigChange({ ...fsConfig, gameAudioEnabled: false })
      showToast('Fullscreen Game Audio disabled.')
      return
    }
    await removeSourceFromScene(sceneName, inputName)
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
            onRowClick={(game) => { closeFsDrawer(); openDrawer(game) }}
            onToggle={toggleGame}
            onEdit={enterEditMode}
            onDelete={removeGame}
            fsConfig={fsConfig}
            onFsConfigChange={onFsConfigChange}
            onFullscreenRowClick={openFsDrawer}
            fsDrawerOpen={fsDrawerOpen}
            onCreateFullscreenScene={handleCreateFullscreenScene}
          />
        </div>

        <GameDetailDrawer
          gameId={drawerGameId}
          game={selectedGame}
          isEditing={isEditing}
          sceneAudioSources={sceneAudioSourcesForDisplay}
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
          addSourceToScene={handleAddSourceForSelectedGame}
          removeSourceFromScene={handleRemoveSourceForSelectedGame}
          addMasterSource={addMasterSource}
          trackData={trackData}
          trackLoading={trackLoading}
          trackLabels={trackLabels}
          toggleTrack={toggleTrack}
          onCreateScene={handleCreateScene}
          creatingScene={creatingScene}
          applyMasterOnCreateScene={applyMasterOnCreateScene}
          setApplyMasterOnCreateScene={setApplyMasterOnCreateScene}
          fsDrawerOpen={fsDrawerOpen}
          fsConfig={fsConfig}
          onFsConfigChange={onFsConfigChange}
          onCloseFsDrawer={closeFsDrawer}
          fsSceneAudioSources={fsSceneAudioSourcesForDisplay}
          fsAudioLoading={fsAudioLoading}
          addFsSource={handleAddFsSource}
          removeFsSource={handleRemoveFsSource}
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
