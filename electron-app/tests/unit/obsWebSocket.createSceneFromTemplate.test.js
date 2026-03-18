import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

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
      .mockResolvedValueOnce({ scenes: [] }) // GetSceneList
      .mockResolvedValue(undefined) // CreateScene
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
      .mockResolvedValueOnce({ scenes: [{ sceneName: 'Template' }] }) // GetSceneList
      .mockResolvedValueOnce(undefined) // CreateScene
      .mockResolvedValueOnce({
        sceneItems: [
          // GetSceneItemList
          { sceneItemId: 1, sourceName: 'Capture' },
          { sceneItemId: 2, sourceName: 'Audio' },
        ],
      })
      .mockResolvedValue(undefined) // DuplicateSceneItem x2
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'NewScene', 'Template')
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/2\/2/)
    const dupCalls = mockObsCall.mock.calls.filter((c) => c[0] === 'DuplicateSceneItem')
    expect(dupCalls).toHaveLength(2)
  })

  it('reports partial copy when some items fail to duplicate', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [{ sceneName: 'Template' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        sceneItems: [
          { sceneItemId: 1, sourceName: 'A' },
          { sceneItemId: 2, sourceName: 'B' },
        ],
      })
      .mockResolvedValueOnce(undefined) // DuplicateSceneItem A succeeds
      .mockRejectedValueOnce(new Error('nested scene not supported')) // DuplicateSceneItem B fails
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'NewScene', 'Template')
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/1\/2/)
  })

  it('removes created scene and returns error when template copy throws unexpectedly', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [{ sceneName: 'Template' }] })
      .mockResolvedValueOnce(undefined) // CreateScene
      .mockRejectedValueOnce(new Error('unexpected error')) // GetSceneItemList throws
      .mockResolvedValue(undefined) // RemoveScene cleanup
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'NewScene', 'Template')
    expect(result.success).toBe(false)
    const removeCalls = mockObsCall.mock.calls.filter((c) => c[0] === 'RemoveScene')
    expect(removeCalls).toHaveLength(1)
    expect(removeCalls[0][1].sceneName).toBe('NewScene')
  })

  it('returns failure when OBS connection fails', async () => {
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { createSceneFromTemplate } = await getModule()
    const result = await createSceneFromTemplate({}, 'NewScene', 'Template')
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('trims whitespace from scene name', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [] }).mockResolvedValue(undefined)
    const { createSceneFromTemplate } = await getModule()
    await createSceneFromTemplate({}, '  NewScene  ', null)
    expect(mockObsCall).toHaveBeenCalledWith('CreateScene', { sceneName: 'NewScene' })
  })
})
