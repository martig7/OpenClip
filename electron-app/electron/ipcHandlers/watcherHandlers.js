/**
 * IPC handlers for the game watcher lifecycle.
 */
const fs = require('fs')
const { setupGameWatcher } = require('../gameWatcher')
const { RUNTIME_DIR, STATE_FILE } = require('../constants')

function registerWatcherHandlers(ipcMain, store, appState) {
  ipcMain.handle('watcher:start', async () => {
    // Guard against concurrent start calls
    if (appState.watcher || appState.watcherStarting) return { running: true }
    appState.watcherStarting = true

    try {
      try {
        fs.mkdirSync(RUNTIME_DIR, { recursive: true })
        if (!fs.existsSync(STATE_FILE)) fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8')
      } catch (fsErr) {
        console.error('[watcherHandlers] watcher:start — filesystem setup failed:', fsErr.message)
        return { running: false, error: fsErr.message }
      }

      const { runAutoDelete } = require('../recordingService')
      runAutoDelete().catch((err) => {
        console.warn('[watcherHandlers] runAutoDelete failed (non-fatal):', err.message)
      })

      try {
        appState.watcherStartedAt = Date.now()
        appState.watcher = setupGameWatcher(
          store,
          (state) => {
            appState.currentGame = state.currentGame
            appState.pushWatcherStatus()
            appState.registerHotkey()
          },
          (progress) => {
            try {
              appState.mainWindow?.webContents.send('session:process-progress', progress)
            } catch (err) {
              console.warn('[watcherHandlers] IPC send session:process-progress failed:', err.message)
            }
          },
          () => {
            try {
              appState.mainWindow?.webContents.send('games:updated')
            } catch (err) {
              console.warn('[watcherHandlers] IPC send games:updated failed:', err.message)
            }
          }
        )
      } catch (err) {
        console.error('[watcherHandlers] setupGameWatcher failed:', err.message)
        appState.watcher = null
        appState.watcherStartedAt = null
        return { running: false, error: err.message }
      }

      appState.pushWatcherStatus()
      return { running: true }
    } finally {
      appState.watcherStarting = false
    }
  })

  ipcMain.handle('watcher:stop', () => {
    if (appState.watcher) {
      try {
        appState.watcher.stop()
      } catch (err) {
        console.error('[watcherHandlers] watcher.stop() threw:', err.message)
      } finally {
        appState.watcher = null
        appState.watcherStartedAt = null
        appState.currentGame = null
      }

      try {
        fs.writeFileSync(STATE_FILE, 'IDLE', 'utf-8')
      } catch (err) {
        console.warn('[watcherHandlers] Could not reset STATE_FILE:', err.message)
      }
    }
    appState.pushWatcherStatus()
    return { running: false }
  })

  ipcMain.handle('watcher:status', () => {
    const gameState = appState.readGameState()
    return {
      running: !!appState.watcher,
      currentGame: appState.currentGame,
      startedAt: appState.watcherStartedAt,
      gameState,
    }
  })
}

module.exports = { registerWatcherHandlers }
