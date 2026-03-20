import { describe, it, expect } from 'vitest'
import {
  LEGACY_ENCODING_SECTION_ID,
  SETTINGS_CHIP_IDS,
  SETTINGS_CHIP_LABELS,
  filterSettingsSections,
  isValidSectionId,
  SETTINGS_SECTIONS,
} from '../../src/settings/generalSectionConfig.js'

describe('generalSectionConfig', () => {
  it('filterSettingsSections respects chip and search', () => {
    const updatesOnly = filterSettingsSections('updates', '')
    expect(updatesOnly.map((s) => s.id)).toEqual(['updates'])

    const auto = filterSettingsSections('automation', '')
    expect(auto.some((s) => s.id === 'watcher')).toBe(true)
    expect(auto.some((s) => s.id === 'updates')).toBe(false)

    const enc = filterSettingsSections('encoding', '')
    expect(enc.map((s) => s.id)).toEqual([
      'encoding-profile',
      'encoding-video',
      'encoding-recording',
      'encoding-encoder',
    ])

    const searched = filterSettingsSections('all', 'plugin')
    expect(searched.some((s) => s.id === 'plugin')).toBe(true)
  })

  it('isValidSectionId includes encoding subsections', () => {
    expect(isValidSectionId('encoding-profile')).toBe(true)
    expect(isValidSectionId('encoding')).toBe(false)
    expect(isValidSectionId('nope')).toBe(false)
  })

  it('SETTINGS_SECTIONS ids are unique', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('chip labels exist for every configured chip id', () => {
    for (const chipId of SETTINGS_CHIP_IDS) {
      expect(SETTINGS_CHIP_LABELS[chipId]).toBeTruthy()
    }
  })

  it('legacy encoding section id points to a valid section', () => {
    expect(LEGACY_ENCODING_SECTION_ID).toBe('encoding-profile')
    expect(isValidSectionId(LEGACY_ENCODING_SECTION_ID)).toBe(true)
  })
})
