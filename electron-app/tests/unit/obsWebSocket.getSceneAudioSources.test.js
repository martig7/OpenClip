import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

describe('getSceneAudioSources', () => {
  it('returns empty array when sceneName is empty', async () => {
    const { getSceneAudioSources } = await getModule()
    const result = await getSceneAudioSources({}, '')
    expect(result).toEqual([])
    expect((await import('./obsWebSocket.testHelper.js')).mockObsConnect).not.toHaveBeenCalled()
  })

  it('returns empty array when scene has no items', async () => {
    mockObsCall.mockResolvedValue({ sceneItems: [] })
    const { getSceneAudioSources } = await getModule()
    const result = await getSceneAudioSources({}, 'Scene1')
    expect(result).toEqual([])
  })

  it('returns audio items when inputKind is present on scene item', async () => {
    mockObsCall.mockResolvedValue({
      sceneItems: [
        { sourceName: 'Desktop Audio', inputKind: 'wasapi_output_capture', sceneItemId: 1 },
        { sourceName: 'Game Capture', inputKind: 'game_capture', sceneItemId: 2 },
        { sourceName: 'Mic', inputKind: 'wasapi_input_capture', sceneItemId: 3 },
      ],
    })
    const { getSceneAudioSources } = await getModule()
    const result = await getSceneAudioSources({}, 'Scene1')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      inputName: 'Desktop Audio',
      inputKind: 'wasapi_output_capture',
      sceneItemId: 1,
    })
    expect(result[1]).toEqual({
      inputName: 'Mic',
      inputKind: 'wasapi_input_capture',
      sceneItemId: 3,
    })
  })

  it('falls back to GetInputKind when inputKind is missing from scene item', async () => {
    mockObsCall
      .mockResolvedValueOnce({ sceneItems: [{ sourceName: 'UnknownSource', sceneItemId: 5 }] }) // GetSceneItemList
      .mockResolvedValueOnce({ inputKind: 'wasapi_output_capture' }) // GetInputKind
    const { getSceneAudioSources } = await getModule()
    const result = await getSceneAudioSources({}, 'Scene1')
    expect(result).toHaveLength(1)
    expect(result[0].inputName).toBe('UnknownSource')
    expect(result[0].inputKind).toBe('wasapi_output_capture')
  })

  it('skips item when fallback kind lookup fails', async () => {
    mockObsCall
      .mockResolvedValueOnce({ sceneItems: [{ sourceName: 'Nested Scene', sceneItemId: 7 }] })
      .mockRejectedValueOnce(new Error('not an input')) // GetInputKind fails
    const { getSceneAudioSources } = await getModule()
    const result = await getSceneAudioSources({}, 'Scene1')
    expect(result).toEqual([])
  })

  it('throws when OBS connection fails', async () => {
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { getSceneAudioSources } = await getModule()
    await expect(getSceneAudioSources({}, 'Scene1')).rejects.toThrow()
  })
})
