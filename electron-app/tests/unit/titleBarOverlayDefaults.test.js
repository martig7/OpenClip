import { describe, expect, it } from 'vitest'
import {
  TITLEBAR_OVERLAY_DEFAULTS,
  TITLEBAR_SETTINGS_WARNING,
  getTitleBarOverlayForPath,
} from '../../src/utils/titleBarOverlayDefaults'

describe('titleBarOverlayDefaults', () => {
  it('returns explicit overlay for known settings path', () => {
    expect(getTitleBarOverlayForPath('/settings')).toEqual(TITLEBAR_OVERLAY_DEFAULTS['/settings'])
  })

  it('falls back to _default for unknown paths', () => {
    expect(getTitleBarOverlayForPath('/unknown/path')).toEqual(TITLEBAR_OVERLAY_DEFAULTS._default)
  })

  it('exposes warning overlay colors for unsaved settings leave banner', () => {
    expect(TITLEBAR_SETTINGS_WARNING).toEqual({
      color: '#ef4444',
      symbolColor: '#ffffff',
    })
  })
})
