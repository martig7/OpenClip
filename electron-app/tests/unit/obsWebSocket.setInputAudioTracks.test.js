import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

describe('setInputAudioTracks', () => {
  it('sets track routing and returns success', async () => {
    mockObsCall.mockResolvedValue(undefined)
    const { setInputAudioTracks } = await getModule()
    const tracks = { 1: true, 2: false, 3: false, 4: false, 5: false, 6: false }
    const result = await setInputAudioTracks({}, 'Desktop Audio', tracks)
    expect(result.success).toBe(true)
    expect(result.message).toMatch(/Desktop Audio/)
    expect(mockObsCall).toHaveBeenCalledWith('SetInputAudioTracks', {
      inputName: 'Desktop Audio',
      inputAudioTracks: tracks,
    })
  })

  it('returns error when inputName is empty', async () => {
    const { setInputAudioTracks } = await getModule()
    const result = await setInputAudioTracks({}, '', {})
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/required/i)
  })

  it('returns failure when OBS connection fails', async () => {
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { setInputAudioTracks } = await getModule()
    const result = await setInputAudioTracks({}, 'Desktop Audio', {})
    expect(result.success).toBe(false)
    expect(result.message).toBeTruthy()
  })
})
