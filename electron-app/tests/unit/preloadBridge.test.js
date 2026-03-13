import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'

const req = createRequire(import.meta.url)
const electronMock = req('../../__mocks__/electron.js')
const preloadPath = req.resolve('../../electron/preload.js')

function loadPreloadApi() {
  let exposedApi = null
  electronMock.contextBridge.exposeInMainWorld = vi.fn((name, api) => {
    if (name === 'api') exposedApi = api
  })

  delete req.cache[preloadPath]
  req(preloadPath)

  if (!exposedApi) throw new Error('preload did not expose api bridge')
  return exposedApi
}

describe('preload API bridge integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.ipcRenderer.invoke = vi.fn((_channel, ..._args) => Promise.resolve({ ok: true }))
  })

  it('routes windows endpoints through ipcRenderer.invoke channels', async () => {
    const api = loadPreloadApi()

    await api.getVisibleWindows()
    await api.extractWindowIcon('game')
    await api.listWindowsAudioDevices()
    await api.listRunningApps()

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('windows:list')
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('windows:extractIcon', 'game')
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('windows:list-audio-devices')
    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith('windows:list-running-apps')
  })
})
