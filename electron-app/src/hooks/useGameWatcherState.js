import { useState } from 'react';

/**
 * Manages the game library list and watcher process status.
 * Isolated so that game-list or watcher updates don't bleed into
 * unrelated domains (audio sources, modals, toasts, etc.).
 */
export function useGameWatcherState() {
  const [games, setGames] = useState([]);
  const [watcherStatus, setWatcherStatus] = useState({
    running: false,
    currentGame: null,
    startedAt: null,
    gameState: null,
  });
  const [scriptWarning, setScriptWarning] = useState(null);
  const [confirmDeleteGame, setConfirmDeleteGame] = useState(null); // { game }
  const [editGameModal, setEditGameModal] = useState(null); // { game, sceneAudioSources, loading }

  return {
    games, setGames,
    watcherStatus, setWatcherStatus,
    scriptWarning, setScriptWarning,
    confirmDeleteGame, setConfirmDeleteGame,
    editGameModal, setEditGameModal,
  };
}
