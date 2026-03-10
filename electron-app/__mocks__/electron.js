// Manual mock for the 'electron' npm package.
// Vitest (like Jest) picks this up automatically when vi.mock('electron') is called.
// Placed adjacent to node_modules/ so Vitest finds it for npm package mocks.
const path = require('path')
const os = require('os')

const base = path.join(os.tmpdir(), 'openclip-test', 'userData')

const app = {
  getPath: (key) => {
    const map = {
      userData: base,
      appData: path.join(os.tmpdir(), 'openclip-test', 'appData'),
      temp: path.join(os.tmpdir(), 'openclip-test', 'temp'),
    }
    return map[key] ?? base
  },
  isPackaged: false,
}

const shell = {
  openPath: () => Promise.resolve(''),
  showItemInFolder: () => {},
}

const ipcMain = {
  handle: () => {},
}

const ipcRenderer = {
  invoke: () => Promise.resolve(),
  on: () => {},
  removeListener: () => {},
}

module.exports = { app, shell, ipcMain, ipcRenderer }
