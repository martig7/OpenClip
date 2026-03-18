import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

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
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { testOBSConnection } = await getModule()
    const result = await testOBSConnection({})
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })
})
