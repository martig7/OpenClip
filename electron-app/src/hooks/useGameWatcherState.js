import { useState } from 'react'

/**
 * Manages the game library list and the confirm-delete dialog.
 * Drawer, scene audio, and in-drawer edit draft are handled by useDrawerState.
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
