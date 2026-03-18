import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

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
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { getOBSScenes } = await getModule()
    await expect(getOBSScenes({})).rejects.toThrow()
  })
})
