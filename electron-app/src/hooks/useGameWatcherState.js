import { useState } from 'react'

/**
 * Manages the game library list and modals (confirm-delete, edit-game).
 * Watcher status lives in WatcherRuntimeProvider (sidebar panel).
 */
export function useGameWatcherState() {
  const [games, setGames] = useState([])
  const [confirmDeleteGame, setConfirmDeleteGame] = useState(null) // { game }
  const [editGameModal, setEditGameModal] = useState(null) // { game, sceneAudioSources, loading }

  return {
    games,
    setGames,
    confirmDeleteGame,
    setConfirmDeleteGame,
    editGameModal,
    setEditGameModal,
  }
}
