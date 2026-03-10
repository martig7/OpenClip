// Mock for the 'electron' module in tests.
// Used via vite.config.js test.alias so both ESM import and CJS require are intercepted.
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
