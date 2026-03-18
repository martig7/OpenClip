import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

describe('getInputAudioTracks', () => {
  it('returns track routing object', async () => {
    mockObsCall.mockResolvedValue({
      inputAudioTracks: { 1: true, 2: false, 3: true, 4: false, 5: false, 6: false },
    })
    const { getInputAudioTracks } = await getModule()
    const result = await getInputAudioTracks({}, 'Desktop Audio')
    expect(result['1']).toBe(true)
    expect(result['2']).toBe(false)
  })

  it('returns empty object when inputAudioTracks is null', async () => {
    mockObsCall.mockResolvedValue({ inputAudioTracks: null })
    const { getInputAudioTracks } = await getModule()
    const result = await getInputAudioTracks({}, 'Desktop Audio')
    expect(result).toEqual({})
  })

  it('throws when inputName is empty', async () => {
    const { getInputAudioTracks } = await getModule()
    await expect(getInputAudioTracks({}, '')).rejects.toThrow(/input name is required/i)
  })

  it('throws when OBS connection fails', async () => {
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { getInputAudioTracks } = await getModule()
    await expect(getInputAudioTracks({}, 'Desktop Audio')).rejects.toThrow()
  })
})
