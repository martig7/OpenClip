import { describe, it, expect } from 'vitest'
import {
  BENTO_GRID_COLUMNS,
  computeBentoSpans,
  settingsSectionDomId,
} from '../../src/settings/bentoLayout.js'

function rowSums(spans) {
  const byRow = new Map()
  for (const s of spans) {
    if (!byRow.has(s.gridRow)) byRow.set(s.gridRow, [])
    byRow.get(s.gridRow).push(s.colSpan)
  }
  return [...byRow.values()].map((cols) => cols.reduce((a, b) => a + b, 0))
}

describe('computeBentoSpans', () => {
  it('does not use full-width grid line shorthand for layout', () => {
    const spans = computeBentoSpans(['plugin', 'encoding-profile', 'watcher'])
    expect(spans.every((s) => s.gridColumn !== '1 / -1')).toBe(true)
  })

  it('returns one entry per id in order', () => {
    const ids = ['plugin', 'watcher', 'view']
    const spans = computeBentoSpans(ids)
    expect(spans.map((s) => s.id)).toEqual(ids)
    spans.forEach((s) => {
      expect(s.colSpan).toBeGreaterThanOrEqual(1)
      expect(s.colSpan).toBeLessThanOrEqual(BENTO_GRID_COLUMNS)
      expect(s.rowSpan).toBe(1)
      expect(s.gridRow).toBeGreaterThanOrEqual(1)
      expect(s.gridColumn).toMatch(/^\d+ \/\s*-?\d+$/)
    })
  })

  it('sums to 12 columns per grid row', () => {
    const spans = computeBentoSpans([
      'plugin',
      'watcher',
      'organize',
      'view',
      'hotkey',
      'autoclip',
    ])
    for (const sum of rowSums(spans)) {
      expect(sum).toBe(BENTO_GRID_COLUMNS)
    }
  })

  it('uses explicit column lines that match colSpan within each row', () => {
    const spans = computeBentoSpans(['plugin', 'watcher', 'organize'])
    const byRow = new Map()
    for (const s of spans) {
      if (!byRow.has(s.gridRow)) byRow.set(s.gridRow, [])
      byRow.get(s.gridRow).push(s)
    }
    for (const [, row] of byRow) {
      row.sort((a, b) => {
        const as = parseInt(a.gridColumn.split('/')[0], 10)
        const bs = parseInt(b.gridColumn.split('/')[0], 10)
        return as - bs
      })
      for (const s of row) {
        const [a, b] = s.gridColumn.split('/').map((x) => x.trim())
        const start = parseInt(a, 10)
        const end = parseInt(b, 10)
        expect(end - start).toBe(s.colSpan)
      }
    }
  })

  it('is deterministic for the same ids', () => {
    const a = computeBentoSpans(['plugin', 'watcher', 'organize'])
    const b = computeBentoSpans(['plugin', 'watcher', 'organize'])
    expect(a).toEqual(b)
  })
})

describe('settingsSectionDomId', () => {
  it('prefixes id', () => {
    expect(settingsSectionDomId('hotkey')).toBe('settings-section-hotkey')
  })
})
