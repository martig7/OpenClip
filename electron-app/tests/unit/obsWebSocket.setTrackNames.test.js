import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

describe('setTrackNames', () => {
  it('sets names in both AdvOut and SimpleOutput for all 6 tracks', async () => {
    mockObsCall.mockResolvedValue(undefined)
    const { setTrackNames } = await getModule()
    const names = ['Game', 'Mic', 'Desktop', 'Commentary', 'Music', 'SFX']
    const result = await setTrackNames({}, names)
    expect(result.success).toBe(true)
    const setCalls = mockObsCall.mock.calls.filter((c) => c[0] === 'SetProfileParameter')
    expect(setCalls).toHaveLength(12) // 2 categories × 6 tracks
    const advCalls = setCalls.filter((c) => c[1].parameterCategory === 'AdvOut')
    expect(advCalls[0][1]).toMatchObject({ parameterName: 'Track1Name', parameterValue: 'Game' })
    expect(advCalls[5][1]).toMatchObject({ parameterName: 'Track6Name', parameterValue: 'SFX' })
  })

  it('uses default name for falsy entries', async () => {
    mockObsCall.mockResolvedValue(undefined)
    const { setTrackNames } = await getModule()
    await setTrackNames({}, ['', null, undefined, 'Custom', '', ''])
    const advCalls = mockObsCall.mock.calls.filter(
      (c) => c[0] === 'SetProfileParameter' && c[1].parameterCategory === 'AdvOut'
    )
    expect(advCalls[0][1].parameterValue).toBe('Track 1')
    expect(advCalls[3][1].parameterValue).toBe('Custom')
  })

  it('throws when OBS connection fails', async () => {
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { setTrackNames } = await getModule()
    await expect(setTrackNames({}, ['A', 'B', 'C', 'D', 'E', 'F'])).rejects.toThrow()
  })
})
