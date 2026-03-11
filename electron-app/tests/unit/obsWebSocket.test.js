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
  // Default behavior: return request-specific empty payloads so tests that don't
  // explicitly override the mock still get a sensible (non-crashing) default.
  mockObsCall.mockImplementation((requestType) => {
    switch (requestType) {
      case 'GetSceneList':
        return Promise.resolve({ scenes: [] })
      case 'GetSceneItemList':
        return Promise.resolve({ sceneItems: [] })
      case 'GetInputList':
        return Promise.resolve({ inputs: [] })
      default:
        return Promise.resolve(undefined)
    }
  })
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

  it('uses window_capture when captureKind is window_capture', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })     // GetSceneList
      .mockResolvedValue(undefined)               // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'SomeGame',
      addWindowCapture: true,
      captureKind: 'window_capture',
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

  // ── Window string format tests ──────────────────────────────────────────────
  // OBS canonical format for window strings: Title:WindowClass:Exe.exe
  // Confirmed from OBS source (window-helpers.c ms_build_window_strings).
  // The bracketed [exe]:Class:Title format is OBS UI display-label only, never a stored value.

  it('game_capture window string uses Title:Class:Exe format when exe and windowClass are provided', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })  // GetSceneList
      .mockResolvedValue(undefined)            // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'Valorant',
      exe: 'VALORANT-Win64-Shipping.exe',
      windowClass: 'UnrealWindow',
      addWindowCapture: true,
    })
    expect(result.success).toBe(true)
    const captureCall = mockObsCall.mock.calls.find(c => c[0] === 'CreateInput' && c[1].inputKind === 'game_capture')
    expect(captureCall).toBeTruthy()
    expect(captureCall[1].inputSettings.window).toBe('Valorant:UnrealWindow:VALORANT-Win64-Shipping.exe')
  })

  it('game_capture falls back to title-only window string when exe/windowClass are absent', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })
      .mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'Valorant',
      addWindowCapture: true,
      // exe and windowClass intentionally omitted
    })
    expect(result.success).toBe(true)
    const captureCall = mockObsCall.mock.calls.find(c => c[0] === 'CreateInput' && c[1].inputKind === 'game_capture')
    expect(captureCall).toBeTruthy()
    expect(captureCall[1].inputSettings.window).toBe('Valorant')
  })

  it('window_capture uses Title:Class:Exe format when captureKind is window_capture', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })  // GetSceneList
      .mockResolvedValue(undefined)            // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'SomeGame',
      exe: 'somegame.exe',
      windowClass: 'GameWindow',
      addWindowCapture: true,
      captureKind: 'window_capture',
    })
    expect(result.success).toBe(true)
    const windowCaptureCall = mockObsCall.mock.calls.find(c => c[0] === 'CreateInput' && c[1].inputKind === 'window_capture')
    expect(windowCaptureCall).toBeTruthy()
    expect(windowCaptureCall[1].inputSettings.window).toBe('SomeGame:GameWindow:somegame.exe')
  })

  it('desktop audio inputSettings has no window field', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })
      .mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    await createSceneFromScratch({}, 'TestScene', { addDesktopAudio: true })
    const desktopCall = mockObsCall.mock.calls.find(c => c[0] === 'CreateInput' && c[1].inputKind === 'wasapi_output_capture')
    expect(desktopCall).toBeTruthy()
    expect(desktopCall[1].inputSettings).toEqual({})
    expect(desktopCall[1].inputSettings).not.toHaveProperty('window')
  })

  it('microphone inputSettings has no window field', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })
      .mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    await createSceneFromScratch({}, 'TestScene', { addMicAudio: true })
    const micCall = mockObsCall.mock.calls.find(c => c[0] === 'CreateInput' && c[1].inputKind === 'wasapi_input_capture')
    expect(micCall).toBeTruthy()
    expect(micCall[1].inputSettings).toEqual({})
    expect(micCall[1].inputSettings).not.toHaveProperty('window')
  })

  it('all sources together: video uses Title:Class:Exe, audio inputs have empty inputSettings', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })
      .mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      exe: 'mygame.exe',
      windowClass: 'MyGameClass',
      addWindowCapture: true,
      addDesktopAudio: true,
      addMicAudio: true,
    })
    expect(result.success).toBe(true)
    const calls = mockObsCall.mock.calls.filter(c => c[0] === 'CreateInput')
    expect(calls).toHaveLength(3)

    const captureCall = calls.find(c => c[1].inputKind === 'game_capture')
    expect(captureCall[1].inputSettings.window).toBe('MyGame:MyGameClass:mygame.exe')

    const desktopCall = calls.find(c => c[1].inputKind === 'wasapi_output_capture')
    expect(desktopCall[1].inputSettings).toEqual({})
    expect(desktopCall[1].inputSettings).not.toHaveProperty('window')

    const micCall = calls.find(c => c[1].inputKind === 'wasapi_input_capture')
    expect(micCall[1].inputSettings).toEqual({})
    expect(micCall[1].inputSettings).not.toHaveProperty('window')
  })

  // ── captureKind option tests ────────────────────────────────────────────────

  it('captureKind: "game_capture" uses only game_capture and never tries window_capture', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })  // GetSceneList
      .mockResolvedValue(undefined)            // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      exe: 'mygame.exe',
      windowClass: 'MyGameWindow',
      addWindowCapture: true,
      captureKind: 'game_capture',
    })
    expect(result.success).toBe(true)
    const gameCaptureCall = mockObsCall.mock.calls.find(c => c[0] === 'CreateInput' && c[1].inputKind === 'game_capture')
    expect(gameCaptureCall).toBeTruthy()
    const windowCaptureCall = mockObsCall.mock.calls.find(c => c[0] === 'CreateInput' && c[1].inputKind === 'window_capture')
    expect(windowCaptureCall).toBeUndefined()
    expect(result.message).toMatch(/game capture/)
  })

  it('captureKind: "window_capture" skips game_capture and uses window_capture directly', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })  // GetSceneList
      .mockResolvedValue(undefined)            // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      exe: 'mygame.exe',
      windowClass: 'MyGameWindow',
      addWindowCapture: true,
      captureKind: 'window_capture',
    })
    expect(result.success).toBe(true)
    const gameCaptureCall = mockObsCall.mock.calls.find(c => c[0] === 'CreateInput' && c[1].inputKind === 'game_capture')
    expect(gameCaptureCall).toBeUndefined()
    const windowCaptureCall = mockObsCall.mock.calls.find(c => c[0] === 'CreateInput' && c[1].inputKind === 'window_capture')
    expect(windowCaptureCall).toBeTruthy()
    expect(windowCaptureCall[1].inputSettings.window).toBe('MyGame:MyGameWindow:mygame.exe')
    expect(result.message).toMatch(/window capture/)
  })

  it('captureKind: "game_capture" surfaces error on failure instead of falling back to window_capture', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })                                        // GetSceneList
      .mockResolvedValueOnce(undefined)                                              // CreateScene
      .mockRejectedValueOnce(new Error('game_capture not supported on this OS'))    // game_capture fails
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      addWindowCapture: true,
      captureKind: 'game_capture',
    })
    // Should still succeed overall but report the capture error
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/could not be added|game capture/i)
    const windowCaptureCall = mockObsCall.mock.calls.find(c => c[0] === 'CreateInput' && c[1].inputKind === 'window_capture')
    expect(windowCaptureCall).toBeUndefined()
  })

  // ── fit-to-screen tests ─────────────────────────────────────────────────────

  it('calls GetVideoSettings and SetSceneItemTransform after creating a capture source', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })           // GetSceneList
      .mockResolvedValueOnce(undefined)                 // CreateScene
      .mockResolvedValueOnce({ sceneItemId: 42 })      // CreateInput (game_capture)
      .mockResolvedValueOnce({ baseWidth: 1920, baseHeight: 1080 }) // GetVideoSettings
      .mockResolvedValue(undefined)                     // SetSceneItemTransform
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      addWindowCapture: true,
    })
    expect(result.success).toBe(true)
    expect(mockObsCall).toHaveBeenCalledWith('GetVideoSettings')
    expect(mockObsCall).toHaveBeenCalledWith('SetSceneItemTransform', expect.objectContaining({
      sceneName: 'TestScene',
      sceneItemId: 42,
      sceneItemTransform: expect.objectContaining({
        positionX: 0,
        positionY: 0,
        boundsType: 'OBS_BOUNDS_SCALE_INNER',
        boundsWidth: 1920,
        boundsHeight: 1080,
      }),
    }))
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
      .mockResolvedValueOnce({ sceneItems: [] })                 // GetSceneItemList Scene1
      .mockRejectedValueOnce(new Error('input already exists'))  // CreateInput Scene1 fails
      .mockResolvedValueOnce({ inputUuid: 'abc' })               // GetInputSettings (fallback)
      .mockResolvedValueOnce(undefined)                          // CreateSceneItem (fallback)
      .mockResolvedValueOnce({ sceneItems: [] })                 // GetSceneItemList Scene2
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

  it('calls SetSceneItemTransform when fitToCanvas option is true', async () => {
    mockObsCall
      .mockResolvedValueOnce({ baseWidth: 1920, baseHeight: 1080 })       // GetVideoSettings (hoisted before loop)
      .mockResolvedValueOnce({ sceneItems: [] })                          // GetSceneItemList Scene1
      .mockResolvedValueOnce({ sceneItemId: 99 })                         // CreateInput → returns sceneItemId
      // SetSceneItemTransform uses default undefined
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes({}, ['Scene1'], 'game_capture', 'My Game Capture', {}, { fitToCanvas: true })
    expect(result.success).toBe(true)
    const transformCall = mockObsCall.mock.calls.find(c => c[0] === 'SetSceneItemTransform')
    expect(transformCall).toBeTruthy()
    expect(transformCall[1]).toMatchObject({ sceneName: 'Scene1', sceneItemId: 99 })
    expect(transformCall[1].sceneItemTransform.boundsType).toBe('OBS_BOUNDS_SCALE_INNER')
  })

  it('does not call SetSceneItemTransform when fitToCanvas is omitted', async () => {
    // default mock returns undefined for CreateInput → sceneItemId is undefined
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes({}, ['Scene1'], 'wasapi_output_capture', 'Desktop Audio', {})
    expect(result.success).toBe(true)
    const transformCall = mockObsCall.mock.calls.find(c => c[0] === 'SetSceneItemTransform')
    expect(transformCall).toBeFalsy()
  })
})

// ─── getOBSScenes ────────────────────────────────────────────────────────────

describe('getOBSScenes', () => {
  it('returns array of scene names', async () => {
    mockObsCall.mockResolvedValue({ scenes: [{ sceneName: 'Scene1' }, { sceneName: 'Scene2' }] })
    const { getOBSScenes } = await getModule()
    const result = await getOBSScenes({})
    expect(result).toEqual(['Scene1', 'Scene2'])
  })

  it('returns empty array when no scenes', async () => {
    mockObsCall.mockResolvedValue({ scenes: [] })
    const { getOBSScenes } = await getModule()
    const result = await getOBSScenes({})
    expect(result).toEqual([])
  })

  it('throws when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { getOBSScenes } = await getModule()
    await expect(getOBSScenes({})).rejects.toThrow()
  })
})

// ─── createSceneFromTemplate ──────────────────────────────────────────────────

describe('createSceneFromTemplate', () => {
  it('returns error when newSceneName is empty', async () => {
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, '')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/scene name is required/i)
  })

  it('returns error when scene already exists', async () => {
    mockObsCall.mockResolvedValue({ scenes: [{ sceneName: 'Existing' }] })
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'Existing', null)
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/already exists/i)
  })

  it('creates empty scene when no template provided', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })  // GetSceneList
      .mockResolvedValue(undefined)            // CreateScene
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'NewScene', null)
    expect(result.success).toBe(true)
    expect(mockObsCall).toHaveBeenCalledWith('CreateScene', { sceneName: 'NewScene' })
  })

  it('creates empty scene when template is not found', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [{ sceneName: 'OtherScene' }] })
      .mockResolvedValue(undefined)
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'NewScene', 'MissingTemplate')
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/not found/i)
  })

  it('duplicates sources from template scene', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [{ sceneName: 'Template' }] })  // GetSceneList
      .mockResolvedValueOnce(undefined)                                  // CreateScene
      .mockResolvedValueOnce({ sceneItems: [                            // GetSceneItemList
        { sceneItemId: 1, sourceName: 'Capture' },
        { sceneItemId: 2, sourceName: 'Audio' },
      ]})
      .mockResolvedValue(undefined)                                      // DuplicateSceneItem x2
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'NewScene', 'Template')
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/2\/2/)
    const dupCalls = mockObsCall.mock.calls.filter(c => c[0] === 'DuplicateSceneItem')
    expect(dupCalls).toHaveLength(2)
  })

  it('reports partial copy when some items fail to duplicate', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [{ sceneName: 'Template' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ sceneItems: [
        { sceneItemId: 1, sourceName: 'A' },
        { sceneItemId: 2, sourceName: 'B' },
      ]})
      .mockResolvedValueOnce(undefined)                                   // DuplicateSceneItem A succeeds
      .mockRejectedValueOnce(new Error('nested scene not supported'))     // DuplicateSceneItem B fails
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'NewScene', 'Template')
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/1\/2/)
  })

  it('removes created scene and returns error when template copy throws unexpectedly', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [{ sceneName: 'Template' }] })
      .mockResolvedValueOnce(undefined)                     // CreateScene
      .mockRejectedValueOnce(new Error('unexpected error')) // GetSceneItemList throws
      .mockResolvedValue(undefined)                         // RemoveScene cleanup
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'NewScene', 'Template')
    expect(result.success).toBe(false)
    const removeCalls = mockObsCall.mock.calls.filter(c => c[0] === 'RemoveScene')
    expect(removeCalls).toHaveLength(1)
    expect(removeCalls[0][1].sceneName).toBe('NewScene')
  })

  it('returns failure when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'NewScene', 'Template')
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('trims whitespace from scene name', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] })
      .mockResolvedValue(undefined)
    const { createSceneFromTemplate } = await getModule()
    await createSceneFromTemplate({}, '  NewScene  ', null)
    expect(mockObsCall).toHaveBeenCalledWith('CreateScene', { sceneName: 'NewScene' })
  })
})

// ─── testOBSConnection ────────────────────────────────────────────────────────

describe('testOBSConnection', () => {
  it('returns success with version string', async () => {
    mockObsCall.mockResolvedValue({ obsVersion: '30.0.0', obsWebSocketVersion: '5.0.1' })
    const { testOBSConnection } = await getModule()
    const result = await testOBSConnection({})
    expect(result.success).toBe(true)
    expect(result.version).toMatch(/OBS 30.0.0/)
    expect(result.version).toMatch(/5.0.1/)
  })

  it('returns failure with message when connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { testOBSConnection } = await getModule()
    const result = await testOBSConnection({})
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })
})

// ─── getOBSAudioInputs ────────────────────────────────────────────────────────

describe('getOBSAudioInputs', () => {
  it('returns only audio inputs filtered by kind', async () => {
    mockObsCall.mockResolvedValue({ inputs: [
      { inputName: 'Desktop Audio', inputKind: 'wasapi_output_capture' },
      { inputName: 'Microphone', inputKind: 'wasapi_input_capture' },
      { inputName: 'Game Capture', inputKind: 'game_capture' },
      { inputName: 'Browser', inputKind: 'browser_source' },
    ]})
    const { getOBSAudioInputs } = await getModule()
    const result = await getOBSAudioInputs({})
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ inputName: 'Desktop Audio', inputKind: 'wasapi_output_capture' })
    expect(result[1]).toEqual({ inputName: 'Microphone', inputKind: 'wasapi_input_capture' })
  })

  it('returns empty array when no audio inputs exist', async () => {
    mockObsCall.mockResolvedValue({ inputs: [{ inputName: 'Webcam', inputKind: 'dshow_input' }] })
    const { getOBSAudioInputs } = await getModule()
    const result = await getOBSAudioInputs({})
    expect(result).toEqual([])
  })

  it('returns empty array when inputs list is empty', async () => {
    mockObsCall.mockResolvedValue({ inputs: [] })
    const { getOBSAudioInputs } = await getModule()
    const result = await getOBSAudioInputs({})
    expect(result).toEqual([])
  })

  it('throws when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { getOBSAudioInputs } = await getModule()
    await expect(getOBSAudioInputs({})).rejects.toThrow()
  })
})

// ─── getSceneAudioSources ─────────────────────────────────────────────────────

describe('getSceneAudioSources', () => {
  it('returns empty array when sceneName is empty', async () => {
    const { getSceneAudioSources } = await getModule()
    const result = await getSceneAudioSources({}, '')
    expect(result).toEqual([])
    expect(mockObsConnect).not.toHaveBeenCalled()
  })

  it('returns empty array when scene has no items', async () => {
    mockObsCall.mockResolvedValue({ sceneItems: [] })
    const { getSceneAudioSources } = await getModule()
    const result = await getSceneAudioSources({}, 'Scene1')
    expect(result).toEqual([])
  })

  it('returns audio items when inputKind is present on scene item', async () => {
    mockObsCall.mockResolvedValue({ sceneItems: [
      { sourceName: 'Desktop Audio', inputKind: 'wasapi_output_capture', sceneItemId: 1 },
      { sourceName: 'Game Capture', inputKind: 'game_capture', sceneItemId: 2 },
      { sourceName: 'Mic', inputKind: 'wasapi_input_capture', sceneItemId: 3 },
    ]})
    const { getSceneAudioSources } = await getModule()
    const result = await getSceneAudioSources({}, 'Scene1')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ inputName: 'Desktop Audio', inputKind: 'wasapi_output_capture', sceneItemId: 1 })
    expect(result[1]).toEqual({ inputName: 'Mic', inputKind: 'wasapi_input_capture', sceneItemId: 3 })
  })

  it('falls back to GetInputKind when inputKind is missing from scene item', async () => {
    mockObsCall
      .mockResolvedValueOnce({ sceneItems: [{ sourceName: 'UnknownSource', sceneItemId: 5 }] }) // GetSceneItemList
      .mockResolvedValueOnce({ inputKind: 'wasapi_output_capture' })                             // GetInputKind
    const { getSceneAudioSources } = await getModule()
    const result = await getSceneAudioSources({}, 'Scene1')
    expect(result).toHaveLength(1)
    expect(result[0].inputName).toBe('UnknownSource')
    expect(result[0].inputKind).toBe('wasapi_output_capture')
  })

  it('skips item when fallback kind lookup fails', async () => {
    mockObsCall
      .mockResolvedValueOnce({ sceneItems: [{ sourceName: 'Nested Scene', sceneItemId: 7 }] })
      .mockRejectedValueOnce(new Error('not an input'))  // GetInputKind fails
    const { getSceneAudioSources } = await getModule()
    const result = await getSceneAudioSources({}, 'Scene1')
    expect(result).toEqual([])
  })

  it('throws when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { getSceneAudioSources } = await getModule()
    await expect(getSceneAudioSources({}, 'Scene1')).rejects.toThrow()
  })
})

// ─── getInputAudioTracks ──────────────────────────────────────────────────────

describe('getInputAudioTracks', () => {
  it('returns track routing object', async () => {
    mockObsCall.mockResolvedValue({ inputAudioTracks: { '1': true, '2': false, '3': true, '4': false, '5': false, '6': false } })
    const { getInputAudioTracks } = await getModule()
    const result = await getInputAudioTracks({}, 'Desktop Audio')
    expect(result['1']).toBe(true)
    expect(result['2']).toBe(false)
  })

  it('returns empty object when inputAudioTracks is null', async () => {
    mockObsCall.mockResolvedValue({ inputAudioTracks: null })
    const { getInputAudioTracks } = await getModule()
    const result = await getInputAudioTracks({}, 'Desktop Audio')
    expect(result).toEqual({})
  })

  it('throws when inputName is empty', async () => {
    const { getInputAudioTracks } = await getModule()
    await expect(getInputAudioTracks({}, '')).rejects.toThrow(/input name is required/i)
  })

  it('throws when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { getInputAudioTracks } = await getModule()
    await expect(getInputAudioTracks({}, 'Desktop Audio')).rejects.toThrow()
  })
})

// ─── setInputAudioTracks ──────────────────────────────────────────────────────

describe('setInputAudioTracks', () => {
  it('sets track routing and returns success', async () => {
    mockObsCall.mockResolvedValue(undefined)
    const { setInputAudioTracks } = await getModule()
    const tracks = { '1': true, '2': false, '3': false, '4': false, '5': false, '6': false }
    const result = await setInputAudioTracks({}, 'Desktop Audio', tracks)
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/Desktop Audio/)
    expect(mockObsCall).toHaveBeenCalledWith('SetInputAudioTracks', {
      inputName: 'Desktop Audio',
      inputAudioTracks: tracks,
    })
  })

  it('returns error when inputName is empty', async () => {
    const { setInputAudioTracks } = await getModule()
    const result = await setInputAudioTracks({}, '', {})
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/required/i)
  })

  it('returns failure when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { setInputAudioTracks } = await getModule()
    const result = await setInputAudioTracks({}, 'Desktop Audio', {})
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })
})

// ─── getTrackNames ────────────────────────────────────────────────────────────

describe('getTrackNames', () => {
  it('returns track names from AdvOut profile parameters', async () => {
    mockObsCall.mockImplementation((cmd, args) => {
      if (cmd === 'GetProfileParameter' && args.parameterCategory === 'AdvOut') {
        const idx = parseInt(args.parameterName.replace('Track', '').replace('Name', ''))
        return Promise.resolve({ parameterValue: `Custom ${idx}` })
      }
      return Promise.resolve({ parameterValue: '' })
    })
    const { getTrackNames } = await getModule()
    const result = await getTrackNames({})
    expect(result).toHaveLength(6)
    expect(result[0]).toBe('Custom 1')
    expect(result[5]).toBe('Custom 6')
  })

  it('falls back to SimpleOutput when AdvOut has no value', async () => {
    mockObsCall.mockImplementation((cmd, args) => {
      if (cmd === 'GetProfileParameter') {
        if (args.parameterCategory === 'AdvOut') return Promise.resolve({ parameterValue: '' })
        if (args.parameterCategory === 'SimpleOutput') return Promise.resolve({ parameterValue: 'Simple Track' })
      }
      return Promise.resolve({})
    })
    const { getTrackNames } = await getModule()
    const result = await getTrackNames({})
    expect(result[0]).toBe('Simple Track')
  })

  it('returns default names when connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { getTrackNames } = await getModule()
    const result = await getTrackNames({})
    expect(result).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6'])
  })
})

// ─── setTrackNames ────────────────────────────────────────────────────────────

describe('setTrackNames', () => {
  it('sets names in both AdvOut and SimpleOutput for all 6 tracks', async () => {
    mockObsCall.mockResolvedValue(undefined)
    const { setTrackNames } = await getModule()
    const names = ['Game', 'Mic', 'Desktop', 'Commentary', 'Music', 'SFX']
    const result = await setTrackNames({}, names)
    expect(result.success).toBe(true)
    const setCalls = mockObsCall.mock.calls.filter(c => c[0] === 'SetProfileParameter')
    expect(setCalls).toHaveLength(12) // 2 categories × 6 tracks
    const advCalls = setCalls.filter(c => c[1].parameterCategory === 'AdvOut')
    expect(advCalls[0][1]).toMatchObject({ parameterName: 'Track1Name', parameterValue: 'Game' })
    expect(advCalls[5][1]).toMatchObject({ parameterName: 'Track6Name', parameterValue: 'SFX' })
  })

  it('uses default name for falsy entries', async () => {
    mockObsCall.mockResolvedValue(undefined)
    const { setTrackNames } = await getModule()
    await setTrackNames({}, ['', null, undefined, 'Custom', '', ''])
    const advCalls = mockObsCall.mock.calls
      .filter(c => c[0] === 'SetProfileParameter' && c[1].parameterCategory === 'AdvOut')
    expect(advCalls[0][1].parameterValue).toBe('Track 1')
    expect(advCalls[3][1].parameterValue).toBe('Custom')
  })

  it('throws when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { setTrackNames } = await getModule()
    await expect(setTrackNames({}, ['A', 'B', 'C', 'D', 'E', 'F'])).rejects.toThrow()
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
      .mockResolvedValueOnce({ sceneItems: [{ sourceName: 'Desktop Audio', sceneItemId: 20 }] }) // GetSceneItemList Scene2
      // RemoveSceneItem calls use default (undefined)
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

// ─── deleteOBSScene ───────────────────────────────────────────────────────────

describe('deleteOBSScene', () => {
  it('removes the scene when it exists', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [{ sceneName: 'MyScene' }, { sceneName: 'Other' }] }) // GetSceneList
      .mockResolvedValueOnce(undefined) // RemoveScene
    const { deleteOBSScene } = await getModule()
    const result = await deleteOBSScene({}, 'MyScene')
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/MyScene/)
    const removeCall = mockObsCall.mock.calls.find(c => c[0] === 'RemoveScene')
    expect(removeCall).toBeTruthy()
    expect(removeCall[1]).toEqual({ sceneName: 'MyScene' })
  })

  it('returns failure when scene does not exist', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [{ sceneName: 'Other' }] }) // GetSceneList — no MyScene
    const { deleteOBSScene } = await getModule()
    const result = await deleteOBSScene({}, 'MyScene')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not found|does not exist/i)
    const removeCall = mockObsCall.mock.calls.find(c => c[0] === 'RemoveScene')
    expect(removeCall).toBeFalsy()
  })

  it('returns failure when OBS connection fails', async () => {
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { deleteOBSScene } = await getModule()
    const result = await deleteOBSScene({}, 'MyScene')
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })
})

