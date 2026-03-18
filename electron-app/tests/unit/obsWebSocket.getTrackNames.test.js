import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

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
        if (args.parameterCategory === 'SimpleOutput')
          return Promise.resolve({ parameterValue: 'Simple Track' })
      }
      return Promise.resolve({})
    })
    const { getTrackNames } = await getModule()
    const result = await getTrackNames({})
    expect(result[0]).toBe('Simple Track')
  })

  it('returns default names when connection fails', async () => {
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { getTrackNames } = await getModule()
    const result = await getTrackNames({})
    expect(result).toEqual(['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6'])
  })
})
