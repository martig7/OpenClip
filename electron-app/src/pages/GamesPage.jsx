import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { useGameWatcherState } from '../hooks/useGameWatcherState'
import { useAudioSourcesState } from '../hooks/useAudioSourcesState'
import { useToastState } from '../hooks/useToastState'
import { useAddGameModalState } from '../hooks/useAddGameModalState'
import { useTrackState } from '../hooks/useTrackState'
import {
  AUDIO_KIND_META,
  buildAvailableAudioInputs,
  getAppAudioWindowKey,
  isAppAudioKind,
} from './games/audioSourceUtils'
import AddGameModal from './games/AddGameModal'
import SimpleAddGameModal from './games/SimpleAddGameModal'
import { GamesPageBody } from './games/GamesPageBody'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

export default function GamesPage() {
  const navigate = useNavigate()

  const {
    games,
    setGames,
    confirmDeleteGame,
    setConfirmDeleteGame,
  } = useGameWatcherState()

  const {
    masterAudioSources,
    setMasterAudioSources,
    masterAudioLoadedRef,
    applyingSource,
    setApplyingSource,
    showAudioDropdown,
    setShowAudioDropdown,
    availableAudioInputs,
    setAvailableAudioInputs,
    loadingAudioInputs,
    setLoadingAudioInputs,
    audioDropdownError,
    setAudioDropdownError,
    audioDropdownRef,
  } = useAudioSourcesState()

  const { toast, showToast } = useToastState()

  const {
    showAddModal,
    setShowAddModal,
    newGame,
    setNewGame,
    visibleWindows,
    setVisibleWindows,
    loadingWindows,
    setLoadingWindows,
    showWindowPicker,
    setShowWindowPicker,
    autoCreateScene,
    setAutoCreateScene,
    createMode,
    setCreateMode,
    capturePref,
    setCapturePref,
    obsScenes,
    setObsScenes,
    loadingScenes,
    setLoadingScenes,
    scenesError,
    setScenesError,
    templateScene,
    setTemplateScene,
    applyMasterAudioSources,
    setApplyMasterAudioSources,
    sceneCreateStatus,
    setSceneCreateStatus,
    resetAddModal,
  } = useAddGameModalState()

  const { trackLabels, setTrackLabels, trackData, setTrackData, trackLoading, setTrackLoading } =
    useTrackState()

  const trackDataLoadedRef = useRef(false)
  const [advancedGameAddition, setAdvancedGameAddition] = useState(false)
  const [fsConfig, setFsConfig] = useState({ enabled: false, defaultScene: '', gameAudioEnabled: true })

  useEffect(() => {
    const allInputNames = new Set([
      ...masterAudioSources.map((s) => s.name),
    ])
    const namesArray = Array.from(allInputNames)
    if (namesArray.length === 0) return

    let cancelled = false
    ;(async () => {
      const results = await Promise.all(
        namesArray.map(async (name) => {
          if (name === 'Game Audio') return null
          const tracks = await api.getInputAudioTracks(name).catch(() => ({}))
          if (Object.keys(tracks).length === 0) return null
          return { name, tracks }
        })
      )
      if (cancelled) return
      const fresh = {}
      for (const entry of results) {
        if (entry) fresh[entry.name] = entry.tracks
      }
      if (Object.keys(fresh).length > 0) {
        setTrackData((prev) => ({ ...prev, ...fresh }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [masterAudioSources])

  async function toggleTrack(inputName, trackNum) {
    const current = trackData[inputName] || {}
    const newVal = !current[String(trackNum)]
    const updated = { ...current, [String(trackNum)]: newVal }
    setTrackData((prev) => ({ ...prev, [inputName]: updated }))
    setTrackLoading((prev) => ({ ...prev, [inputName]: true }))
    try {
      if (inputName === 'Game Audio') {
        const promises = []
        for (const game of games) {
          if (game.scene) {
            promises.push(
              api.setInputAudioTracks(`Game Audio (${game.name})`, updated).catch(() => {})
            )
          }
        }
        await Promise.all(promises)
      } else {
        await api.setInputAudioTracks(inputName, updated)
      }
    } catch {
      setTrackData((prev) => ({ ...prev, [inputName]: current }))
    } finally {
      setTrackLoading((prev) => ({ ...prev, [inputName]: false }))
    }
  }

  // Subscribe to games:updated push (fired when the watcher auto-registers a new game)
  useEffect(() => {
    const unsub = api.onGamesUpdated(() => loadGames())
    return unsub
  }, [])

  useEffect(() => {
    loadGames()
    loadTrackLabels()
    api
      .getFullscreenRecording()
      .then((cfg) =>
        setFsConfig({
          enabled: !!cfg?.enabled,
          defaultScene: cfg?.defaultScene || '',
          gameAudioEnabled: cfg?.gameAudioEnabled !== false,
        })
      )
      .catch(() => {})
    api
      .getStore('settings')
      .then((s) => {
        if (s?.advancedGameAddition) setAdvancedGameAddition(true)
      })
      .catch(() => {})
    api
      .getStore('masterAudioSources')
      .then((saved) => {
        masterAudioLoadedRef.current = true
        if (Array.isArray(saved) && saved.length > 0) setMasterAudioSources(saved)
      })
      .catch(() => {
        masterAudioLoadedRef.current = true
      })
    api
      .getStore('audioTracks')
      .then((saved) => {
        trackDataLoadedRef.current = true
        if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
          setTrackData((prev) => ({ ...prev, ...saved }))
        }
      })
      .catch(() => {
        trackDataLoadedRef.current = true
      })
  }, [])

  useEffect(() => {
    if (!masterAudioLoadedRef.current) return
    api.setStore('masterAudioSources', masterAudioSources).catch(() => {})
  }, [masterAudioSources])

  useEffect(() => {
    if (!trackDataLoadedRef.current) return
    api.setStore('audioTracks', trackData).catch(() => {})
  }, [trackData])

  async function loadGames() {
    try {
      setGames(await api.getGames())
    } catch (err) {
      showToast(err?.message || 'Failed to load games')
    }
  }

  async function loadTrackLabels() {
    try {
      const labels = await api.getTrackNames()
      if (labels && labels.length === 6) setTrackLabels(labels)
    } catch (err) {
      showToast(err?.message || 'Failed to load track labels')
    }
  }

  async function addGame() {
    const missing = ['name', 'selector', 'scene'].filter((f) => !newGame[f])
    if (missing.length > 0) {
      showToast(`Required fields missing: ${missing.join(', ')}.`)
      return
    }

    if (autoCreateScene && newGame.scene) {
      setSceneCreateStatus(null)
      try {
        let result
        if (createMode === 'scratch') {
          result = await api.createOBSSceneFromScratch(newGame.scene, {
            windowTitle: newGame.selector,
            exe: newGame.exe,
            windowClass: newGame.windowClass,
            addWindowCapture: true,
            captureKind: capturePref,
          })
        } else {
          result = await api.createOBSScene(newGame.scene, templateScene || null)
        }
        if (!result.success) {
          if (result.message?.includes('already exists')) {
            setSceneCreateStatus({ type: 'conflict', message: result.message })
            return
          }
          setSceneCreateStatus({ type: 'error', message: result.message })
          return
        }
        await finalizeGameSave(result.message || `Scene "${newGame.scene}" created in OBS`)
      } catch (err) {
        setSceneCreateStatus({
          type: 'error',
          message: err.message || 'Failed to create OBS scene',
        })
        return
      }
    } else {
      await finalizeGameSave(null)
    }
  }

  async function finalizeGameSave(sceneMsg) {
    const masterToAdd = masterAudioSources
    if (applyMasterAudioSources && newGame.scene && masterToAdd.length > 0) {
      await Promise.all(
        masterToAdd.map((source) => {
          if (source.kind === 'magic_game_audio') {
            const exeGuess =
              newGame.exe ||
              (newGame.selector.toLowerCase().endsWith('.exe')
                ? newGame.selector
                : `${newGame.selector}.exe`)
            const windowClassGuess = newGame.windowClass || newGame.selector
            const titleGuess = newGame.selector
            return api
              .addAudioSourceToScenes(
                [newGame.scene],
                'wasapi_process_output_capture',
                `Game Audio (${newGame.name})`,
                {
                  window: `${titleGuess}:${windowClassGuess}:${exeGuess}`,
                  window_match_priority: newGame.windowMatchPriority ?? 0,
                }
              )
              .catch(() => {})
          }
          return api
            .addAudioSourceToScenes(
              [newGame.scene],
              source.kind,
              source.name,
              source.inputSettings || {}
            )
            .catch(() => {})
        })
      )

      await Promise.all(
        masterToAdd.map((source) => {
          const masterKey = source.kind === 'magic_game_audio' ? 'Game Audio' : source.name
          const tracks = trackData[masterKey]
          if (!tracks || Object.keys(tracks).length === 0) return Promise.resolve()
          const obsInputName =
            source.kind === 'magic_game_audio' ? `Game Audio (${newGame.name})` : source.name
          return api.setInputAudioTracks(obsInputName, tracks).catch(() => {})
        })
      )
    }

    if (sceneMsg) {
      const sourceNote =
        applyMasterAudioSources && newGame.scene && masterToAdd.length > 0
          ? ` + ${masterToAdd.length} master source${masterToAdd.length > 1 ? 's' : ''}`
          : ''
      showToast(sceneMsg + sourceNote)
    }
    await api.addGame(newGame)
    resetAddModal()
    setShowAddModal(false)
    loadGames()
  }

  async function handleSceneConflictUseExisting() {
    setSceneCreateStatus(null)
    try {
      await finalizeGameSave(`Using existing OBS scene "${newGame.scene}"`)
    } catch (err) {
      setSceneCreateStatus({ type: 'error', message: err.message || 'Failed to save game' })
    }
  }

  async function handleSceneConflictOverwrite() {
    setSceneCreateStatus({ type: 'loading', message: `Deleting "${newGame.scene}" from OBS…` })
    try {
      await api.deleteOBSScene(newGame.scene)
      let result
      if (createMode === 'scratch') {
        result = await api.createOBSSceneFromScratch(newGame.scene, {
          windowTitle: newGame.selector,
          exe: newGame.exe,
          windowClass: newGame.windowClass,
          addWindowCapture: true,
          captureKind: capturePref,
        })
      } else {
        result = await api.createOBSScene(newGame.scene, templateScene || null)
      }
      if (!result.success) {
        setSceneCreateStatus({ type: 'error', message: result.message })
        return
      }
      await finalizeGameSave(result.message || `Scene "${newGame.scene}" overwritten in OBS`)
    } catch (err) {
      setSceneCreateStatus({ type: 'error', message: err.message || 'Failed to overwrite scene' })
    }
  }

  async function removeGame(id) {
    const game = games.find((g) => g.id === id)
    if (!game) return
    if (game.scene) {
      setConfirmDeleteGame({ game })
    } else {
      await api.removeGame(id)
      loadGames()
    }
  }

  async function doRemoveGame(includeScene) {
    const { game } = confirmDeleteGame
    setConfirmDeleteGame(null)
    if (includeScene && game.scene) {
      await api.deleteOBSScene(game.scene).catch(() => {})
    }
    await api.removeGame(game.id)
    loadGames()
  }

  async function toggleGame(id) {
    await api.toggleGame(id)
    loadGames()
  }

  function getGameSceneNames() {
    return games.map((g) => g.scene).filter(Boolean)
  }

  async function loadAudioInputsForDropdown() {
    setLoadingAudioInputs(true)
    setAudioDropdownError(null)
    try {
      const combined = await buildAvailableAudioInputs()
      setAvailableAudioInputs(combined)
    } catch (err) {
      setAudioDropdownError(err.message || 'Failed to load audio sources')
    } finally {
      setLoadingAudioInputs(false)
    }
  }

  async function addMasterSource(entry) {
    if (masterAudioSources.some((s) => s.name === entry.name)) {
      setShowAudioDropdown(false)
      return
    }
    const meta = AUDIO_KIND_META[entry.kind]
    const newSource = {
      name: entry.name,
      kind: entry.kind,
      label: meta?.label || entry.name,
      inputSettings: entry.inputSettings || {},
    }
    setMasterAudioSources((prev) => [...prev, newSource])
    setShowAudioDropdown(false)

    if (isAppAudioKind(entry.kind)) {
      const newKey = getAppAudioWindowKey(entry.name, entry.inputSettings?.window)
      const conflict = masterAudioSources.find(
        (s) =>
          isAppAudioKind(s.kind) && getAppAudioWindowKey(s.name, s.inputSettings?.window) === newKey
      )
      if (conflict) {
        showToast(
          `OBS doesn't support two Application Audio sources for the same window — OBS will default to "${conflict.name}" (the first source added).`
        )
      }
    }

    const sceneNames = getGameSceneNames()
    if (sceneNames.length > 0) {
      setApplyingSource(entry.name)
      try {
        if (entry.kind === 'magic_game_audio') {
          const addPromises = games
            .filter((game) => game.scene)
            .map((game) => {
              const exeGuess =
                game.exe ||
                (game.selector.toLowerCase().endsWith('.exe')
                  ? game.selector
                  : `${game.selector}.exe`)
              const windowClassGuess = game.windowClass || game.selector
              const titleGuess = game.selector
              return api
                .addAudioSourceToScenes(
                  [game.scene],
                  'wasapi_process_output_capture',
                  `Game Audio (${game.name})`,
                  {
                    window: `${titleGuess}:${windowClassGuess}:${exeGuess}`,
                    window_match_priority:
                      game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0,
                  }
                )
                .catch(() => {})
            })
          await Promise.all(addPromises)
          showToast(`"Game Audio" applied to scenes`)
        } else {
          const result = await api.addAudioSourceToScenes(
            sceneNames,
            entry.kind,
            entry.name,
            entry.inputSettings || {}
          )
          showToast(result.message || `"${entry.name}" applied to scenes`)
        }
      } catch (err) {
        showToast(`Failed to add to scenes: ${err.message}`)
      } finally {
        setApplyingSource(null)
      }
    }
  }

  async function removeMasterSource(sourceName) {
    setMasterAudioSources((prev) => prev.filter((s) => s.name !== sourceName))
  }

  async function saveGame(gameId, payload) {
    await api.updateGame(gameId, payload)
    loadGames()
    showToast('Game saved')
  }

  async function saveFsConfig(updated) {
    const next = {
      enabled: !!updated?.enabled,
      defaultScene: updated?.defaultScene || '',
      gameAudioEnabled: updated?.gameAudioEnabled !== false,
    }
    setFsConfig(next)
    await api.setFullscreenRecording(next).catch(() => {})
  }

  function openAddModal() {
    resetAddModal()
    setShowAddModal(true)
  }

  function goToSettings() {
    setShowAddModal(false)
    resetAddModal()
    navigate('/settings')
  }

  const gamesAudioProps = useMemo(
    () => ({
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
    }),
    [
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
    ]
  )

  return (
    <>
      <GamesPageBody
        games={games}
        openAddModal={openAddModal}
        toggleGame={toggleGame}
        removeGame={removeGame}
        saveGame={saveGame}
        gamesAudioProps={gamesAudioProps}
        fsConfig={fsConfig}
        onFsConfigChange={saveFsConfig}
      />

      {showAddModal && (
        advancedGameAddition ? (
          <AddGameModal
            newGame={newGame}
            setNewGame={setNewGame}
            showWindowPicker={showWindowPicker}
            setShowWindowPicker={setShowWindowPicker}
            visibleWindows={visibleWindows}
            setVisibleWindows={setVisibleWindows}
            loadingWindows={loadingWindows}
            setLoadingWindows={setLoadingWindows}
            autoCreateScene={autoCreateScene}
            setAutoCreateScene={setAutoCreateScene}
            createMode={createMode}
            setCreateMode={setCreateMode}
            capturePref={capturePref}
            setCapturePref={setCapturePref}
            obsScenes={obsScenes}
            setObsScenes={setObsScenes}
            loadingScenes={loadingScenes}
            setLoadingScenes={setLoadingScenes}
            scenesError={scenesError}
            setScenesError={setScenesError}
            templateScene={templateScene}
            setTemplateScene={setTemplateScene}
            applyMasterAudioSources={applyMasterAudioSources}
            setApplyMasterAudioSources={setApplyMasterAudioSources}
            sceneCreateStatus={sceneCreateStatus}
            onClose={() => {
              resetAddModal()
              setShowAddModal(false)
            }}
            onAddGame={addGame}
            onSceneConflictUseExisting={handleSceneConflictUseExisting}
            onSceneConflictOverwrite={handleSceneConflictOverwrite}
            onGoToSettings={goToSettings}
          />
        ) : (
          <SimpleAddGameModal
            newGame={newGame}
            setNewGame={setNewGame}
            onClose={() => {
              resetAddModal()
              setShowAddModal(false)
            }}
            onAddGame={addGame}
          />
        )
      )}

      {toast && <div className="toast">{toast}</div>}

      <ConfirmDeleteDialog
        confirmDeleteGame={confirmDeleteGame}
        onConfirm={doRemoveGame}
        onCancel={() => setConfirmDeleteGame(null)}
      />
    </>
  )
}
