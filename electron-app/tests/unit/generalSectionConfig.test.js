import { describe, it, expect } from 'vitest'
import {
  filterSettingsSections,
  isValidSectionId,
  SETTINGS_SECTIONS,
} from '../../src/settings/generalSectionConfig.js'

describe('generalSectionConfig', () => {
  it('filterSettingsSections respects chip and search', () => {
    const pathsOnly = filterSettingsSections('paths', '')
    expect(pathsOnly.map((s) => s.id)).toEqual(['paths'])

    const auto = filterSettingsSections('automation', '')
    expect(auto.some((s) => s.id === 'watcher')).toBe(true)
    expect(auto.some((s) => s.id === 'paths')).toBe(false)

    const enc = filterSettingsSections('encoding', '')
    expect(enc.map((s) => s.id)).toEqual(['encoding'])

    const searched = filterSettingsSections('all', 'plugin')
    expect(searched.some((s) => s.id === 'plugin')).toBe(true)
  })

  it('isValidSectionId includes encoding', () => {
    expect(isValidSectionId('paths')).toBe(true)
    expect(isValidSectionId('encoding')).toBe(true)
    expect(isValidSectionId('nope')).toBe(false)
  })

  it('SETTINGS_SECTIONS ids are unique', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
