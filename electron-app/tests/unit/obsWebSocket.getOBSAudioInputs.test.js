import { mockObsCall, getModule } from './obsWebSocket.testHelper.js'
import { describe, it, expect } from 'vitest'

describe('getOBSAudioInputs', () => {
  it('returns only audio inputs filtered by kind', async () => {
    mockObsCall.mockResolvedValue({
      inputs: [
        { inputName: 'Desktop Audio', inputKind: 'wasapi_output_capture' },
        { inputName: 'Microphone', inputKind: 'wasapi_input_capture' },
        { inputName: 'Game Capture', inputKind: 'game_capture' },
        { inputName: 'Browser', inputKind: 'browser_source' },
      ],
    })
    const { getOBSAudioInputs } = await getModule()
    const result = await getOBSAudioInputs({})
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ inputName: 'Desktop Audio', inputKind: 'wasapi_output_capture' })
    expect(result[1]).toEqual({ inputName: 'Microphone', inputKind: 'wasapi_input_capture' })
  })

  it('returns empty array when no audio inputs exist', async () => {
    mockObsCall.mockResolvedValue({ inputs: [{ inputName: 'Webcam', inputKind: 'dshow_input' }] })
    const { getOBSAudioInputs } = await getModule()
    const result = await getOBSAudioInputs({})
    expect(result).toEqual([])
  })

  it('returns empty array when inputs list is empty', async () => {
    mockObsCall.mockResolvedValue({ inputs: [] })
    const { getOBSAudioInputs } = await getModule()
    const result = await getOBSAudioInputs({})
    expect(result).toEqual([])
  })

  it('throws when OBS connection fails', async () => {
    const mockObsConnect = (await import('./obsWebSocket.testHelper.js')).mockObsConnect
    mockObsConnect.mockRejectedValue(Object.assign(new Error('Connection refused'), { code: 1006 }))
    const { getOBSAudioInputs } = await getModule()
    await expect(getOBSAudioInputs({})).rejects.toThrow()
  })
})
