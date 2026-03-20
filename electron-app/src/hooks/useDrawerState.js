import { useState, useMemo, useCallback } from 'react'
import api from '../api'

/**
 * Game detail drawer, scene audio, and in-drawer edit draft (`editedGame`).
 */
export function useDrawerState(games) {
  const [drawerGameId, setDrawerGameId] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editedGame, setEditedGame] = useState(null)

  const [sceneAudioSources, setSceneAudioSources] = useState([])
  const [audioLoading, setAudioLoading] = useState(false)

  const selectedGame = useMemo(() => {
    if (!drawerGameId) return null
    return games.find((g) => g.id === drawerGameId) || null
  }, [drawerGameId, games])

  const loadSceneAudio = useCallback(async (sceneName) => {
    if (!sceneName) {
      setSceneAudioSources([])
      return
    }
    setAudioLoading(true)
    try {
      const sources = await api.getSceneAudioSources(sceneName)
      setSceneAudioSources(sources || [])
    } catch {
      setSceneAudioSources([])
    } finally {
      setAudioLoading(false)
    }
  }, [])

  const openDrawer = useCallback(
    (game) => {
      setDrawerGameId(game.id)
      setIsEditing(false)
      setEditedGame(null)
      loadSceneAudio(game.scene)
    },
    [loadSceneAudio]
  )

  const openDrawerEditing = useCallback(
    (game) => {
      setDrawerGameId(game.id)
      setIsEditing(true)
      loadSceneAudio(game.scene)
    },
    [loadSceneAudio]
  )

  const closeDrawer = useCallback(() => {
    setDrawerGameId(null)
    setIsEditing(false)
    setEditedGame(null)
    setSceneAudioSources([])
    setAudioLoading(false)
  }, [])

  /** Exit edit mode and discard draft. */
  const stopEditing = useCallback(() => {
    setIsEditing(false)
    setEditedGame(null)
  }, [])

  const startEditing = useCallback(() => {
    setIsEditing(true)
  }, [])

  const enterEditMode = useCallback(
    (game) => {
      setEditedGame({ ...game })
      if (drawerGameId === game.id && !isEditing) {
        startEditing()
      } else {
        openDrawerEditing(game)
      }
    },
    [drawerGameId, isEditing, startEditing, openDrawerEditing]
  )

  const changeDraftGame = useCallback((updates) => {
    setEditedGame((prev) => (prev ? { ...prev, ...updates } : null))
  }, [])

  return {
    drawerGameId,
    selectedGame,
    isEditing,
    editedGame,
    changeDraftGame,
    enterEditMode,
    cancelEdit: stopEditing,
    sceneAudioSources,
    setSceneAudioSources,
    audioLoading,
    openDrawer,
    openDrawerEditing,
    closeDrawer,
    startEditing,
    stopEditing,
  }
}
