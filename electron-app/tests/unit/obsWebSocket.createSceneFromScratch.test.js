import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

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
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValue(undefined) // CreateScene
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene')
    expect(result.success).toBe(true)
    expect(result.message).toContain('TestScene')
    expect(mockObsCall).toHaveBeenCalledWith('CreateScene', { sceneName: 'TestScene' })
    const createInputCalls = mockObsCall.mock.calls.filter((c) => c[0] === 'CreateInput')
    expect(createInputCalls).toHaveLength(0)
  })

  it('adds game_capture source when addWindowCapture is true', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValue(undefined) // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'Valorant',
      addWindowCapture: true,
    })
    expect(result.success).toBe(true)
    const createInputCalls = mockObsCall.mock.calls.filter((c) => c[0] === 'CreateInput')
    expect(createInputCalls.length).toBeGreaterThan(0)
    const captureCall = createInputCalls.find((c) => c[1].inputKind === 'game_capture')
    expect(captureCall).toBeTruthy()
    expect(captureCall[1].inputSettings.window).toBe('Valorant')
    expect(result.message).toMatch(/game capture/)
  })

  it('uses window_capture when captureKind is window_capture', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValue(undefined) // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'SomeGame',
      addWindowCapture: true,
      captureKind: 'window_capture',
    })
    expect(result.success).toBe(true)
    const createInputCalls = mockObsCall.mock.calls.filter((c) => c[0] === 'CreateInput')
    const windowCaptureCall = createInputCalls.find((c) => c[1].inputKind === 'window_capture')
    expect(windowCaptureCall).toBeTruthy()
    expect(result.message).toMatch(/window capture/)
  })

  it('adds desktop audio source when addDesktopAudio is true', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [] }).mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', { addDesktopAudio: true })
    expect(result.success).toBe(true)
    const createInputCalls = mockObsCall.mock.calls.filter((c) => c[0] === 'CreateInput')
    const desktopCall = createInputCalls.find((c) => c[1].inputKind === 'wasapi_output_capture')
    expect(desktopCall).toBeTruthy()
    expect(desktopCall[1].inputName).toContain('Desktop Audio')
    expect(result.message).toMatch(/desktop audio/)
  })

  it('adds microphone source when addMicAudio is true', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [] }).mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', { addMicAudio: true })
    expect(result.success).toBe(true)
    const createInputCalls = mockObsCall.mock.calls.filter((c) => c[0] === 'CreateInput')
    const micCall = createInputCalls.find((c) => c[1].inputKind === 'wasapi_input_capture')
    expect(micCall).toBeTruthy()
    expect(micCall[1].inputName).toContain('Microphone')
    expect(result.message).toMatch(/microphone/)
  })

  it('adds all three sources together', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [] }).mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      addWindowCapture: true,
      addDesktopAudio: true,
      addMicAudio: true,
    })
    expect(result.success).toBe(true)
    const createInputCalls = mockObsCall.mock.calls.filter((c) => c[0] === 'CreateInput')
    expect(createInputCalls.length).toBe(3)
    expect(result.message).toMatch(/game capture/)
    expect(result.message).toMatch(/desktop audio/)
    expect(result.message).toMatch(/microphone/)
  })

  it('reports partial failure in message but still succeeds when capture fails', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValueOnce(undefined) // CreateScene
      .mockRejectedValueOnce(new Error('game_capture unavailable')) // game_capture fails
      .mockResolvedValue(undefined) // desktop audio succeeds
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
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', { addDesktopAudio: true })
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('trims whitespace from scene name', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [] }).mockResolvedValue(undefined)
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
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValue(undefined) // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'Valorant',
      exe: 'VALORANT-Win64-Shipping.exe',
      windowClass: 'UnrealWindow',
      addWindowCapture: true,
    })
    expect(result.success).toBe(true)
    const captureCall = mockObsCall.mock.calls.find(
      (c) => c[0] === 'CreateInput' && c[1].inputKind === 'game_capture'
    )
    expect(captureCall).toBeTruthy()
    expect(captureCall[1].inputSettings.window).toBe(
      'Valorant:UnrealWindow:VALORANT-Win64-Shipping.exe'
    )
  })

  it('game_capture falls back to title-only window string when exe/windowClass are absent', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [] }).mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'Valorant',
      addWindowCapture: true,
      // exe and windowClass intentionally omitted
    })
    expect(result.success).toBe(true)
    const captureCall = mockObsCall.mock.calls.find(
      (c) => c[0] === 'CreateInput' && c[1].inputKind === 'game_capture'
    )
    expect(captureCall).toBeTruthy()
    expect(captureCall[1].inputSettings.window).toBe('Valorant')
  })

  it('window_capture uses Title:Class:Exe format when captureKind is window_capture', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValue(undefined) // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'SomeGame',
      exe: 'somegame.exe',
      windowClass: 'GameWindow',
      addWindowCapture: true,
      captureKind: 'window_capture',
    })
    expect(result.success).toBe(true)
    const windowCaptureCall = mockObsCall.mock.calls.find(
      (c) => c[0] === 'CreateInput' && c[1].inputKind === 'window_capture'
    )
    expect(windowCaptureCall).toBeTruthy()
    expect(windowCaptureCall[1].inputSettings.window).toBe('SomeGame:GameWindow:somegame.exe')
  })

  it('desktop audio inputSettings has no window field', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [] }).mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    await createSceneFromScratch({}, 'TestScene', { addDesktopAudio: true })
    const desktopCall = mockObsCall.mock.calls.find(
      (c) => c[0] === 'CreateInput' && c[1].inputKind === 'wasapi_output_capture'
    )
    expect(desktopCall).toBeTruthy()
    expect(desktopCall[1].inputSettings).toEqual({})
    expect(desktopCall[1].inputSettings).not.toHaveProperty('window')
  })

  it('microphone inputSettings has no window field', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [] }).mockResolvedValue(undefined)
    const { createSceneFromScratch } = await getModule()
    await createSceneFromScratch({}, 'TestScene', { addMicAudio: true })
    const micCall = mockObsCall.mock.calls.find(
      (c) => c[0] === 'CreateInput' && c[1].inputKind === 'wasapi_input_capture'
    )
    expect(micCall).toBeTruthy()
    expect(micCall[1].inputSettings).toEqual({})
    expect(micCall[1].inputSettings).not.toHaveProperty('window')
  })

  it('all sources together: video uses Title:Class:Exe, audio inputs have empty inputSettings', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [] }).mockResolvedValue(undefined)
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
    const calls = mockObsCall.mock.calls.filter((c) => c[0] === 'CreateInput')
    expect(calls).toHaveLength(3)

    const captureCall = calls.find((c) => c[1].inputKind === 'game_capture')
    expect(captureCall[1].inputSettings.window).toBe('MyGame:MyGameClass:mygame.exe')

    const desktopCall = calls.find((c) => c[1].inputKind === 'wasapi_output_capture')
    expect(desktopCall[1].inputSettings).toEqual({})
    expect(desktopCall[1].inputSettings).not.toHaveProperty('window')

    const micCall = calls.find((c) => c[1].inputKind === 'wasapi_input_capture')
    expect(micCall[1].inputSettings).toEqual({})
    expect(micCall[1].inputSettings).not.toHaveProperty('window')
  })

  // ── captureKind option tests ────────────────────────────────────────────────

  it('captureKind: "game_capture" uses only game_capture and never tries window_capture', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValue(undefined) // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      exe: 'mygame.exe',
      windowClass: 'MyGameWindow',
      addWindowCapture: true,
      captureKind: 'game_capture',
    })
    expect(result.success).toBe(true)
    const gameCaptureCall = mockObsCall.mock.calls.find(
      (c) => c[0] === 'CreateInput' && c[1].inputKind === 'game_capture'
    )
    expect(gameCaptureCall).toBeTruthy()
    const windowCaptureCall = mockObsCall.mock.calls.find(
      (c) => c[0] === 'CreateInput' && c[1].inputKind === 'window_capture'
    )
    expect(windowCaptureCall).toBeUndefined()
    expect(result.message).toMatch(/game capture/)
  })

  it('captureKind: "window_capture" skips game_capture and uses window_capture directly', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValue(undefined) // CreateScene + CreateInput
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      exe: 'mygame.exe',
      windowClass: 'MyGameWindow',
      addWindowCapture: true,
      captureKind: 'window_capture',
    })
    expect(result.success).toBe(true)
    const gameCaptureCall = mockObsCall.mock.calls.find(
      (c) => c[0] === 'CreateInput' && c[1].inputKind === 'game_capture'
    )
    expect(gameCaptureCall).toBeUndefined()
    const windowCaptureCall = mockObsCall.mock.calls.find(
      (c) => c[0] === 'CreateInput' && c[1].inputKind === 'window_capture'
    )
    expect(windowCaptureCall).toBeTruthy()
    expect(windowCaptureCall[1].inputSettings.window).toBe('MyGame:MyGameWindow:mygame.exe')
    expect(result.message).toMatch(/window capture/)
  })

  it('captureKind: "game_capture" surfaces error on failure instead of falling back to window_capture', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValueOnce(undefined) // CreateScene
      .mockRejectedValueOnce(new Error('game_capture not supported on this OS')) // game_capture fails
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      addWindowCapture: true,
      captureKind: 'game_capture',
    })
    // Should still succeed overall but report the capture error
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/could not be added|game capture/i)
    const windowCaptureCall = mockObsCall.mock.calls.find(
      (c) => c[0] === 'CreateInput' && c[1].inputKind === 'window_capture'
    )
    expect(windowCaptureCall).toBeUndefined()
  })

  // ── fit-to-screen tests ─────────────────────────────────────────────────────

  it('calls GetVideoSettings and SetSceneItemTransform after creating a capture source', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValueOnce(undefined) // CreateScene
      .mockResolvedValueOnce({ sceneItemId: 42 }) // CreateInput (game_capture)
      .mockResolvedValueOnce({ baseWidth: 1920, baseHeight: 1080 }) // GetVideoSettings
      .mockResolvedValue(undefined) // SetSceneItemTransform
    const { createSceneFromScratch } = await getModule()
    const result = await createSceneFromScratch({}, 'TestScene', {
      windowTitle: 'MyGame',
      addWindowCapture: true,
    })
    expect(result.success).toBe(true)
    expect(mockObsCall).toHaveBeenCalledWith('GetVideoSettings')
    expect(mockObsCall).toHaveBeenCalledWith(
      'SetSceneItemTransform',
      expect.objectContaining({
        sceneName: 'TestScene',
        sceneItemId: 42,
        sceneItemTransform: expect.objectContaining({
          positionX: 0,
          positionY: 0,
          boundsType: 'OBS_BOUNDS_SCALE_INNER',
          boundsWidth: 1920,
          boundsHeight: 1080,
        }),
      })
    )
  })
})
