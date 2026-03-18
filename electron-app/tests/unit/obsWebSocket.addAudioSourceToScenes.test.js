import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

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
    const result = await addAudioSourceToScenes(
      {},
      ['Scene1', 'Scene2'],
      'wasapi_output_capture',
      'Desktop Audio'
    )
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/2 scene/)
    const calls = mockObsCall.mock.calls.filter((c) => c[0] === 'CreateInput')
    expect(calls).toHaveLength(2)
    expect(calls[0][1].sceneName).toBe('Scene1')
    expect(calls[1][1].sceneName).toBe('Scene2')
  })

  it('falls back to CreateSceneItem when CreateInput fails (input already exists)', async () => {
    mockObsCall
      .mockResolvedValueOnce({ sceneItems: [] }) // GetSceneItemList Scene1
      .mockRejectedValueOnce(new Error('input already exists')) // CreateInput Scene1 fails
      .mockResolvedValueOnce({ inputUuid: 'abc' }) // GetInputSettings (fallback)
      .mockResolvedValueOnce(undefined) // CreateSceneItem (fallback)
      .mockResolvedValueOnce({ sceneItems: [] }) // GetSceneItemList Scene2
      .mockResolvedValueOnce(undefined) // CreateInput Scene2 succeeds
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes(
      {},
      ['Scene1', 'Scene2'],
      'wasapi_output_capture',
      'Desktop Audio'
    )
    expect(result.success).toBe(true)
    expect(result.results[0].status).toBe('added (existing source)')
    expect(result.results[1].status).toBe('added')
  })

  it('returns failure when OBS connection fails', async () => {
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes(
      {},
      ['Scene1'],
      'wasapi_output_capture',
      'Desktop Audio'
    )
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('calls SetSceneItemTransform when fitToCanvas option is true', async () => {
    mockObsCall
      .mockResolvedValueOnce({ baseWidth: 1920, baseHeight: 1080 }) // GetVideoSettings (hoisted before loop)
      .mockResolvedValueOnce({ sceneItems: [] }) // GetSceneItemList Scene1
      .mockResolvedValueOnce({ sceneItemId: 99 }) // CreateInput → returns sceneItemId
    // SetSceneItemTransform uses default undefined
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes(
      {},
      ['Scene1'],
      'game_capture',
      'My Game Capture',
      {},
      { fitToCanvas: true }
    )
    expect(result.success).toBe(true)
    const transformCall = mockObsCall.mock.calls.find((c) => c[0] === 'SetSceneItemTransform')
    expect(transformCall).toBeTruthy()
    expect(transformCall[1]).toMatchObject({ sceneName: 'Scene1', sceneItemId: 99 })
    expect(transformCall[1].sceneItemTransform.boundsType).toBe('OBS_BOUNDS_SCALE_INNER')
  })

  it('does not call SetSceneItemTransform when fitToCanvas is omitted', async () => {
    // default mock returns undefined for CreateInput → sceneItemId is undefined
    const { addAudioSourceToScenes } = await getModule()
    const result = await addAudioSourceToScenes(
      {},
      ['Scene1'],
      'wasapi_output_capture',
      'Desktop Audio',
      {}
    )
    expect(result.success).toBe(true)
    const transformCall = mockObsCall.mock.calls.find((c) => c[0] === 'SetSceneItemTransform')
    expect(transformCall).toBeFalsy()
  })
})
