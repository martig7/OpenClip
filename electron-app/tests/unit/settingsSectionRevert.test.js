import { describe, it, expect } from 'vitest'
import {
  applySectionRevert,
  isSettingsSectionDirty,
  SETTINGS_SECTION_REVERT_PATHS,
} from '../../src/settings/settingsSectionRevert.js'

const base = {
  startWatcherOnStartup: true,
  organizeRemux: true,
  listView: true,
  waveformResolution: 'default',
  clipMarkerHotkey: 'F9',
  autoClip: { enabled: false, bufferBefore: 30 },
  destinationPath: '/a',
  autoDelete: { enabled: false },
  obsRecordingPath: '/obs',
}

const baselineStr = JSON.stringify(base)

describe('settingsSectionRevert', () => {
  it('maps every general section id except encoding', () => {
    const ids = Object.keys(SETTINGS_SECTION_REVERT_PATHS)
    expect(ids).toContain('watcher')
    expect(ids).toContain('updates')
    expect(SETTINGS_SECTION_REVERT_PATHS.updates).toEqual([])
  })

  it('detects dirty watcher section', () => {
    const s = { ...base, startWatcherOnStartup: false }
    expect(isSettingsSectionDirty('watcher', s, baselineStr)).toBe(true)
    expect(isSettingsSectionDirty('watcher', base, baselineStr)).toBe(false)
  })

  it('reverts watcher fields from baseline', () => {
    const s = { ...base, startWatcherOnStartup: false }
    const next = applySectionRevert(s, baselineStr, 'watcher')
    expect(next.startWatcherOnStartup).toBe(true)
  })
})
