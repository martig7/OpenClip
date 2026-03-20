/** @param {number | null | undefined} startedAt */
export function formatWatcherUptime(startedAt) {
  if (!startedAt) return ''
  const seconds = Math.floor((Date.now() - startedAt) / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** @param {string | null | undefined} gameState */
export function parseWatcherGameState(gameState) {
  if (!gameState) return { label: 'No state file', color: 'var(--text-muted)' }
  if (gameState.startsWith('RECORDING')) {
    const parts = gameState.split('|')
    const game = parts[1] || 'Unknown'
    const scene = parts[2] || ''
    return {
      label: `Recording ${game}${scene ? ` (Scene: ${scene})` : ''}`,
      color: 'var(--danger)',
      recording: true,
      game,
    }
  }
  if (gameState === 'IDLE')
    return { label: 'Idle - watching for games', color: 'var(--text-secondary)' }
  return { label: gameState, color: 'var(--text-muted)' }
}
