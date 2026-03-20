import { describe, it, expect } from 'vitest'
import {
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
})
