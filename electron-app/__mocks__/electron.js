// Manual mock for the 'electron' npm package.
// Vitest (like Jest) picks this up automatically when vi.mock('electron') is called.
// Placed adjacent to node_modules/ so Vitest finds it for npm package mocks.
const path = require('path')
const os = require('os')

const base = path.join(os.tmpdir(), 'openclip-test', 'userData')
const _handlers = new Map()

function noop() {}

const app = {
  setPath: noop,
  getPath: (key) => {
    const map = {
      userData: base,
      appData: path.join(os.tmpdir(), 'openclip-test', 'appData'),
      temp: path.join(os.tmpdir(), 'openclip-test', 'temp'),
    }
    return map[key] ?? base
  },
  whenReady: () => new Promise(() => {}),
  on: noop,
  quit: noop,
  getFileIcon: async () => ({ toPNG: () => Buffer.from('png') }),
  isPackaged: false,
}

class BrowserWindow {
  static getAllWindows() { return [] }

  constructor() {
    this.webContents = {
      openDevTools: noop,
      send: noop,
    }
  }

  loadURL() { return Promise.resolve() }
  on() {}
  getSize() { return [1200, 800] }
  isDestroyed() { return false }
}

const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
}

const globalShortcut = {
  register: () => true,
  unregisterAll: noop,
}

const protocol = {
  registerSchemesAsPrivileged: noop,
  handle: noop,
}

const net = {
  fetch: async () => ({ ok: true }),
}

const clipboard = {
  writeText: noop,
}

const shell = {
  openPath: () => Promise.resolve(''),
  showItemInFolder: () => {},
  openExternal: () => Promise.resolve(),
}

const ipcMain = {
  handle: (channel, handler) => {
    _handlers.set(channel, handler)
  },
  __getHandler: (channel) => _handlers.get(channel),
  __resetHandlers: () => _handlers.clear(),
}

const ipcRenderer = {
  invoke: () => Promise.resolve(),
  on: () => {},
  removeListener: () => {},
}

const contextBridge = {
  exposeInMainWorld: noop,
}

module.exports = {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  contextBridge,
  ipcMain,
  ipcRenderer,
  net,
  protocol,
  shell,
}
