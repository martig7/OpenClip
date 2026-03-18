import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

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
    const removeCalls = mockObsCall.mock.calls.filter((c) => c[0] === 'RemoveSceneItem')
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
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { removeAudioSourceFromScenes } = await getModule()
    const result = await removeAudioSourceFromScenes({}, ['Scene1'], 'Desktop Audio')
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })
})
