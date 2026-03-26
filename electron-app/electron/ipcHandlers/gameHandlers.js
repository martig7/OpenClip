/**
 * IPC handlers for game management, fullscreen recording config, and hotkeys.
 */

function registerGameHandlers(ipcMain, store, appState) {
  // --- Games ---
  ipcMain.handle('games:list', () => store.get('games') || [])

  ipcMain.handle('games:destination-folders', () => {
    const fs = require('fs')
    const path = require('path')
    const destPath = store.get('settings.destinationPath')
    if (!destPath || !fs.existsSync(destPath)) return []
    const EXCLUDED = new Set(['unorganized', 'clips'])
    try {
      return fs
        .readdirSync(destPath, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !EXCLUDED.has(e.name.toLowerCase()))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  })

  ipcMain.handle('games:add', (_event, game) => {
    const games = Array.isArray(store.get('games')) ? store.get('games') : []
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
    games.push({ id, ...game, enabled: true })
    store.set('games', games)
    return games
  })

  ipcMain.handle('games:remove', (_event, id) => {
    const games = (store.get('games') || []).filter((g) => g.id !== id)
    store.set('games', games)
    return games
  })

  ipcMain.handle('games:toggle', (_event, id) => {
    const games = store.get('games') || []
    const game = games.find((g) => g.id === id)
    if (game) game.enabled = !game.enabled
    store.set('games', games)
    return games
  })

  ipcMain.handle('games:update', (_event, id, updates) => {
    const games = store.get('games') || []
    const game = games.find((g) => g.id === id)
    if (game) {
      // Prevent the caller from overwriting the game's own id
      const { id: _discarded, ...safeUpdates } = updates
      Object.assign(game, safeUpdates)
    }
    store.set('games', games)
    return games
  })

  // --- Fullscreen recording config ---
  ipcMain.handle('fullscreen-recording:get', () => store.get('fullscreenRecording'))
  ipcMain.handle('fullscreen-recording:set', (_event, config) => {
    store.set('fullscreenRecording', config)
  })

  // --- Clip marker hotkey ---
  ipcMain.handle('hotkey:register', () => {
    appState.registerHotkey()
    return true
  })
}

module.exports = { registerGameHandlers }
