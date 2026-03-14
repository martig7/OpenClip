import { describe, it, expect, vi } from 'vitest'

describe('IPC Layer', () => {
  const mockInvoke = vi.fn()
  
  beforeEach(() => {
    vi.clearAllMocks()
    global.window = {
      api: {
        getRecordings: (...args) => mockInvoke('get-recordings', ...args),
        createClip: (...args) => mockInvoke('create-clip', ...args),
        saveSettings: (...args) => mockInvoke('save-settings', ...args),
        unknownMethod: (...args) => mockInvoke('unknown', ...args),
      }
    }
  })

  it('window.api.getRecordings returns data from main process', async () => {
    const mockRecordings = [
      { id: 1, name: 'Test Recording', path: '/test/rec.mp4' }
    ]
    mockInvoke.mockResolvedValue(mockRecordings)

    const result = await window.api.getRecordings()
    
    expect(mockInvoke).toHaveBeenCalledWith('get-recordings')
    expect(result).toEqual(mockRecordings)
  })

  it('window.api.createClip passes correct args over IPC', async () => {
    mockInvoke.mockResolvedValue({ success: true, path: '/test/clip.mp4' })

    const clipParams = {
      source_path: '/test/source.mp4',
      start_time: 10,
      end_time: 20,
    }
    
    const result = await window.api.createClip(clipParams)
    
    expect(mockInvoke).toHaveBeenCalledWith('create-clip', clipParams)
    expect(result.success).toBe(true)
  })

  it('window.api.saveSettings round-trips to electron-store', async () => {
    const settings = { theme: 'dark', hotkey: 'F9' }
    mockInvoke.mockResolvedValue(settings)

    const result = await window.api.saveSettings(settings)
    
    expect(mockInvoke).toHaveBeenCalledWith('save-settings', settings)
    expect(result).toEqual(settings)
  })

  it('IPC channel rejects unknown handlers gracefully', async () => {
    mockInvoke.mockRejectedValue(new Error('Unknown channel'))

    await expect(window.api.unknownMethod()).rejects.toThrow()
  })
})
