import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shared call tracker for the mock OBS WebSocket instance
const mockObsCall = vi.fn()
const mockObsConnect = vi.fn()
const mockObsDisconnect = vi.fn()

// obs-websocket-js exports a class (constructor). Use a proper class mock so
// `new OBSWebSocket()` works correctly inside obsWebSocket.js.
vi.mock('obs-websocket-js', () => {
  class MockOBSWebSocket {
    call(...args) { return mockObsCall(...args) }
    connect(...args) { return mockObsConnect(...args) }
    disconnect(...args) { return mockObsDisconnect(...args) }
  }
  return { default: MockOBSWebSocket }
})

beforeEach(() => {
  vi.clearAllMocks()
  mockObsConnect.mockResolvedValue(undefined)
  mockObsDisconnect.mockResolvedValue(undefined)
  // Default: empty scene list (used by GetSceneList calls)
  mockObsCall.mockResolvedValue({ scenes: [] })
})

async function getModule() {
  vi.resetModules()
  return await import('../../electron/obsWebSocket.js')
}

// ─── createSceneFromScratch ───────────────────────────────────────────────────

describe('createSceneFromScratch', () => {
  it('returns error when sceneName is empty', async () => {
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, '')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/scene name is required/i)
  })

  it('returns error when scene already exists', async () => {
    mockObsCall.mockResolvedValue({ scenes: [{ sceneName: 'MyScene' }] })
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'MyScene')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/already exists/i)
  })

  it('creates an empty scene when no options provided', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })   // GetSceneList
      .mockResolvedValue(undefined)             // CreateScene
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene')
    expect(result.success).toBe(true)
    expect(result.message).toContain('TestScene')
    expect(mockObsCall).toHaveBeenCalledWith('CreateScene', { sceneName: 'TestScene' })
    const createInputCalls = mockObsCall.mock.calls.filter(c => c[0] === 'CreateInput')
    expect(createInputCalls).toHaveLength(0)
  })

  it('adds game_capture source when addWindowCapture is true', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })   // GetSceneList
      .mockResolvedValue(undefined)             // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'Valorant',
      addWindowCapture: true,
    })
    expect(result.success).toBe(true)
    const createInputCalls = mockObsCall.mock.calls.filter(c => c[0] === 'CreateInput')
    expect(createInputCalls.length).toBeGreaterThan(0)
    const captureCall = createInputCalls.find(c => c[1].inputKind === 'game_capture')
    expect(captureCall).toBeTruthy()
    expect(captureCall[1].inputSettings.window).toBe('Valorant')
    expect(result.message).toMatch(/game capture/)
  })

  it('falls back to window_capture when game_capture fails', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })     // GetSceneList
      .mockResolvedValueOnce(undefined)           // CreateScene
      .mockRejectedValueOnce(new Error('game_capture unavailable')) // game_capture fails
      .mockResolvedValue(undefined)               // window_capture succeeds
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'SomeGame',
      addWindowCapture: true,
    })
    expect(result.success).toBe(true)
    const createInputCalls = mockObsCall.mock.calls.filter(c => c[0] === 'CreateInput')
    const windowCaptureCall = createInputCalls.find(c => c[1].inputKind === 'window_capture')
    expect(windowCaptureCall).toBeTruthy()
    expect(result.message).toMatch(/window capture/)
  })

  it('adds desktop audio source when addDesktopAudio is true', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })
      .mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', { addDesktopAudio: true })
    expect(result.success).toBe(true)
    const createInputCalls = mockObsCall.mock.calls.filter(c => c[0] === 'CreateInput')
    const desktopCall = createInputCalls.find(c => c[1].inputKind === 'wasapi_output_capture')
    expect(desktopCall).toBeTruthy()
    expect(desktopCall[1].inputName).toContain('Desktop Audio')
    expect(result.message).toMatch(/desktop audio/)
  })

  it('adds microphone source when addMicAudio is true', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })
      .mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', { addMicAudio: true })
    expect(result.success).toBe(true)
    const createInputCalls = mockObsCall.mock.calls.filter(c => c[0] === 'CreateInput')
    const micCall = createInputCalls.find(c => c[1].inputKind === 'wasapi_input_capture')
    expect(micCall).toBeTruthy()
    expect(micCall[1].inputName).toContain('Microphone')
    expect(result.message).toMatch(/microphone/)
  })

  it('adds all three sources together', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })
      .mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      addWindowCapture: true,
      addDesktopAudio: true,
      addMicAudio: true,
    })
    expect(result.success).toBe(true)
    const createInputCalls = mockObsCall.mock.calls.filter(c => c[0] === 'CreateInput')
    expect(createInputCalls.length).toBe(3)
    expect(result.message).toMatch(/game capture/)
    expect(result.message).toMatch(/desktop audio/)
    expect(result.message).toMatch(/microphone/)
  })

  it('reports partial failure in message but still succeeds when capture fails', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })   // GetSceneList
      .mockResolvedValueOnce(undefined)         // CreateScene
      .mockRejectedValueOnce(new Error('game_capture unavailable'))   // game_capture fails
      .mockRejectedValueOnce(new Error('window_capture unavailable')) // window_capture fails
      .mockResolvedValue(undefined)             // desktop audio succeeds
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      addWindowCapture: true,
      addDesktopAudio: true,
    })
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/could not be added/i)
    expect(result.message).toMatch(/desktop audio/)
  })

  it('returns failure when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', { addDesktopAudio: true })
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('trims whitespace from scene name', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })
      .mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, '  TestScene  ')
    expect(result.success).toBe(true)
    expect(mockObsCall).toHaveBeenCalledWith('CreateScene', { sceneName: 'TestScene' })
  })
})

// ─── addAudioSourceToScenes ──────────────────────────────────────────────────

describe('addAudioSourceToScenes', () => {
  it('returns error when sceneNames is empty', async () => {
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes({}, [], 'wasapi_output_capture', 'Desktop Audio')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/no scene names/i)
  })

  it('returns error when inputKind is missing', async () => {
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes({}, ['Scene1'], '', 'Desktop Audio')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/required/i)
  })

  it('creates input in each scene and reports added count', async () => {
    mockObsCall.mockResolvedValue(undefined) // CreateInput succeeds
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes({}, ['Scene1', 'Scene2'], 'wasapi_output_capture', 'Desktop Audio')
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/2 scene/)
    const calls = mockObsCall.mock.calls.filter(c => c[0] === 'CreateInput')
    expect(calls).toHaveLength(2)
    expect(calls[0][1].sceneName).toBe('Scene1')
    expect(calls[1][1].sceneName).toBe('Scene2')
  })

  it('falls back to CreateSceneItem when CreateInput fails (input already exists)', async () => {
    mockObsCall
      .mockRejectedValueOnce(new Error('input already exists'))  // CreateInput Scene1 fails
      .mockResolvedValueOnce({ inputUuid: 'abc' })               // GetInputSettings
      .mockResolvedValueOnce(undefined)                          // CreateSceneItem
      .mockResolvedValueOnce(undefined)                          // CreateInput Scene2 succeeds
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes({}, ['Scene1', 'Scene2'], 'wasapi_output_capture', 'Desktop Audio')
    expect(result.success).toBe(true)
    expect(result.results[0].status).toBe('added (existing source)')
    expect(result.results[1].status).toBe('added')
  })

  it('returns failure when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes({}, ['Scene1'], 'wasapi_output_capture', 'Desktop Audio')
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })
})

// ─── removeAudioSourceFromScenes ─────────────────────────────────────────────

describe('removeAudioSourceFromScenes', () => {
  it('returns error when sceneNames is empty', async () => {
    const { removeAudioSourceFromScenes } = await getModule()
    const result = await removeAudioSourceFromScenes({}, [], 'Desktop Audio')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/no scene names/i)
  })

  it('returns error when inputName is missing', async () => {
    const { removeAudioSourceFromScenes } = await getModule()
    const result = await removeAudioSourceFromScenes({}, ['Scene1'], '')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/required/i)
  })

  it('removes matching scene items from each scene', async () => {
    mockObsCall
      .mockResolvedValueOnce({ sceneItems: [{ sourceName: 'Desktop Audio', sceneItemId: 10 }] }) // GetSceneItemList Scene1
      .mockResolvedValueOnce(undefined)                                                           // RemoveSceneItem
      .mockResolvedValueOnce({ sceneItems: [{ sourceName: 'Desktop Audio', sceneItemId: 20 }] }) // GetSceneItemList Scene2
      .mockResolvedValueOnce(undefined)                                                           // RemoveSceneItem
    const { removeAudioSourceFromScenes } = await getModule()
    const result = await removeAudioSourceFromScenes({}, ['Scene1', 'Scene2'], 'Desktop Audio')
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/removed from 2/)
    const removeCalls = mockObsCall.mock.calls.filter(c => c[0] === 'RemoveSceneItem')
    expect(removeCalls).toHaveLength(2)
  })

  it('reports not found when source is not in a scene', async () => {
    mockObsCall.mockResolvedValue({ sceneItems: [] }) // no items in any scene
    const { removeAudioSourceFromScenes } = await getModule()
    const result = await removeAudioSourceFromScenes({}, ['Scene1'], 'Desktop Audio')
    expect(result.success).toBe(true)
    expect(result.results[0].status).toBe('not found')
    expect(result.message).toMatch(/not found in 1/)
  })

  it('returns failure when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { removeAudioSourceFromScenes } = await getModule()
    const result = await removeAudioSourceFromScenes({}, ['Scene1'], 'Desktop Audio')
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })
})

