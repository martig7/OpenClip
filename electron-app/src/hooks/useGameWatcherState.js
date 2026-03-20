import { useState } from 'react'

/**
 * Manages the game library list and the confirm-delete dialog.
 * Drawer and edit state are now handled by useDrawerState.
 */
export function useGameWatcherState() {
  const [games, setGames] = useState([])
  const [confirmDeleteGame, setConfirmDeleteGame] = useState(null)

  return {
    games,
    setGames,
    confirmDeleteGame,
    setConfirmDeleteGame,
  }
}
