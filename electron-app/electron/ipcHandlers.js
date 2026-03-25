/**
 * Registers all IPC handlers for the Electron main process.
 * Call registerIpcHandlers(store, appState) after the store is initialized.
 *
 * appState is a mutable object shared with main.js:
 *   { watcher, watcherStartedAt, currentGame, mainWindow, apiPort, apiPortReady }
 *
 * Domain handlers are split into:
 *   ipcHandlers/gameHandlers.js      — games, fullscreen-recording, hotkey
 *   ipcHandlers/watcherHandlers.js   — watcher lifecycle
 *   ipcHandlers/obsHandlers.js       — all OBS operations
 *   ipcHandlers/windowHandlers.js    — Win32 window/process/audio queries
 *   ipcHandlers/recordingHandlers.js — dialogs, shell, store, onboarding, recordings, auto-updater
 */
const { globalShortcut } = require('electron')
const fs = require('fs')
const { setupFileManager } = require('./fileManager')
const { STATE_FILE } = require('./constants')

const { registerGameHandlers } = require('./ipcHandlers/gameHandlers')
const { registerWatcherHandlers } = require('./ipcHandlers/watcherHandlers')
const { registerObsHandlers } = require('./ipcHandlers/obsHandlers')
const { registerWindowHandlers } = require('./ipcHandlers/windowHandlers')
const { registerRecordingHandlers } = require('./ipcHandlers/recordingHandlers')

function registerIpcHandlers(store, appState) {
  // appState: { watcher, watcherStartedAt, currentGame, mainWindow, apiPort, apiPortReady }

  // --- Shared helpers exposed on appState so domain handlers can call them ---

  function readGameState() {
    try {
      return fs.readFileSync(STATE_FILE, 'utf-8').trim()
    } catch {
      return null
    }
  }

  function pushWatcherStatus() {
    if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
      const gameState = readGameState()
      appState.mainWindow.webContents.send('watcher:status-push', {
        running: !!appState.watcher,
        currentGame: appState.currentGame,
        startedAt: appState.watcherStartedAt,
        gameState,
      })
    }
  }

  function registerHotkey() {
    globalShortcut.unregisterAll()
    const hotkey = store.get('settings.clipMarkerHotkey')
    if (hotkey && appState.currentGame) {
      globalShortcut.register(hotkey, () => {
        const markers = store.get('clipMarkers') || []
        markers.push({
          game: appState.currentGame,
          timestamp: Date.now() / 1000,
          created: new Date().toISOString(),
        })
        store.set('clipMarkers', markers)
        if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
          appState.mainWindow.webContents.send('clip:marker-added', markers.length)
        }
      })
    }
  }

  // Make helpers accessible to domain handlers via appState
  appState.registerHotkey = registerHotkey
  appState.pushWatcherStatus = pushWatcherStatus
  appState.readGameState = readGameState

  // --- Recordings & Clips (delegated to fileManager) ---
  const { ipcMain } = require('electron')
  setupFileManager(ipcMain, store)

  // --- Domain handler registration ---
  registerGameHandlers(ipcMain, store, appState)
  registerWatcherHandlers(ipcMain, store, appState)
  registerObsHandlers(ipcMain, store, appState)
  registerWindowHandlers(ipcMain, store, appState)
  registerRecordingHandlers(ipcMain, store, appState)
}

module.exports = { registerIpcHandlers }
