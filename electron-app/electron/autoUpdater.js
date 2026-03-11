'use strict';

const { autoUpdater } = require('electron-updater');

/**
 * Wire up all electron-updater event handlers.
 * @param {() => Electron.BrowserWindow | null} getMainWindow - returns the current main window
 */
function setupAutoUpdater(getMainWindow) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:available', { version: info.version });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:progress', { percent: Math.round(progress.percent) });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:downloaded');
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err.message);
  });

  // Delay the first check so the UI has time to load.
  setTimeout(() => {
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      console.error('[updater] check failed:', err.message);
    }
  }, 5000);
}

/**
 * Register the update-related IPC handlers.
 * Kept separate from setupAutoUpdater so they can be tested independently.
 * @param {Electron.IpcMain} ipcMain
 */
function registerUpdateHandlers(ipcMain) {
  ipcMain.handle('update:check', () => {
    try { autoUpdater.checkForUpdates(); } catch { /* ignore */ }
  });

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
  });
}

module.exports = { setupAutoUpdater, registerUpdateHandlers, autoUpdater };
