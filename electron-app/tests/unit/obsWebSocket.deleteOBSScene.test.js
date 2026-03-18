import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

describe('deleteOBSScene', () => {
  it('removes the scene when it exists', async () => {
    mockObsCall
      .mockResolvedValueOnce({ scenes: [{ sceneName: 'MyScene' }, { sceneName: 'Other' }] }) // GetSceneList
      .mockResolvedValueOnce(undefined) // RemoveScene
    const { deleteOBSScene } = await getModule()
    const result = await deleteOBSScene({}, 'MyScene')
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/MyScene/)
    const removeCall = mockObsCall.mock.calls.find((c) => c[0] === 'RemoveScene')
    expect(removeCall).toBeTruthy()
    expect(removeCall[1]).toEqual({ sceneName: 'MyScene' })
  })

  it('returns failure when scene does not exist', async () => {
    mockObsCall.mockResolvedValueOnce({ scenes: [{ sceneName: 'Other' }] }) // GetSceneList — no MyScene
    const { deleteOBSScene } = await getModule()
    const result = await deleteOBSScene({}, 'MyScene')
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not found|does not exist/i)
    const removeCall = mockObsCall.mock.calls.find((c) => c[0] === 'RemoveScene')
    expect(removeCall).toBeFalsy()
  })

  it('returns failure when OBS connection fails', async () => {
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { deleteOBSScene } = await getModule()
    const result = await deleteOBSScene({}, 'MyScene')
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })
})
