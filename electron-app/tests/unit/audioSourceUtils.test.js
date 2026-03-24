import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/api.js', () => ({
  default: {},
}))

import {
  FULLSCREEN_GAME_AUDIO_PREFIX,
  fullscreenManagedGameAudioInputName,
  normalizeAudioTrackMap,
} from '../../src/pages/games/audioSourceUtils.jsx'

describe('fullscreenManagedGameAudioInputName', () => {
  it('uses lowercased exe when present (matches gameWatcher)', () => {
    expect(
      fullscreenManagedGameAudioInputName({ exe: 'VALORANT.exe', name: 'Valorant' })
    ).toBe(`${FULLSCREEN_GAME_AUDIO_PREFIX} valorant.exe)`)
  })

  it('falls back to lowercased name when exe missing', () => {
    expect(fullscreenManagedGameAudioInputName({ name: 'My Game' })).toBe(
      `${FULLSCREEN_GAME_AUDIO_PREFIX} my game)`
    )
  })

  it('uses "unknown" when exe and name missing', () => {
    expect(fullscreenManagedGameAudioInputName({})).toBe(
      `${FULLSCREEN_GAME_AUDIO_PREFIX} unknown)`
    )
  })
})

describe('normalizeAudioTrackMap', () => {
  it('maps numeric and string keys to string keys with strict booleans', () => {
    const raw = { 1: true, 2: 1, 3: 'true', 4: false, 5: 0, 6: undefined }
    expect(normalizeAudioTrackMap(raw)).toEqual({
      '1': true,
      '2': true,
      '3': true,
      '4': false,
      '5': false,
      '6': false,
    })
  })

  it('returns empty object for non-objects', () => {
    expect(normalizeAudioTrackMap(null)).toEqual({})
    expect(normalizeAudioTrackMap(undefined)).toEqual({})
  })
})
