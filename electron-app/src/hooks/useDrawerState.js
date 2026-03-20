import { useState, useMemo, useCallback } from 'react'
import api from '../api'

/** Game detail drawer + scene audio when a row is selected. */
export function useDrawerState(games) {
  const [drawerGameId, setDrawerGameId] = useState(null)
  const [isEditing, setIsEditing] = useState(false)

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

  const openDrawer = useCallback((game) => {
    setDrawerGameId(game.id)
    setIsEditing(false)
    loadSceneAudio(game.scene)
  }, [loadSceneAudio])

  const openDrawerEditing = useCallback((game) => {
    setDrawerGameId(game.id)
    setIsEditing(true)
    loadSceneAudio(game.scene)
  }, [loadSceneAudio])

  const closeDrawer = useCallback(() => {
    setDrawerGameId(null)
    setIsEditing(false)
    setSceneAudioSources([])
    setAudioLoading(false)
  }, [])

  const stopEditing = useCallback(() => {
    setIsEditing(false)
  }, [])

  const startEditing = useCallback(() => {
    setIsEditing(true)
  }, [])

  return {
    drawerGameId,
    selectedGame,
    isEditing,
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
