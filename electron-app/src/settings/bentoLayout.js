/**
 * Row-based bento layout for a 12-column CSS grid.
 * Self-contained: assigns explicit grid rows and column lines so each row sums to 12,
 * vertical gutters align per row, and items are not auto-reordered (no dense packing holes).
 */

export const BENTO_GRID_COLUMNS = 12

/** Full-width sections always occupy their own row. */
const FULL_WIDTH_IDS = new Set([])

/**
 * Row templates: each array is one row, values are column spans (must sum to 12).
 * Cycled in order so the grid alternates familiar bento rhythms (8+4, triples, etc.).
 */
const ROW_TEMPLATES = [
  [8, 4],
  [6, 6],
  [4, 8],
  [7, 5],
  [5, 7],
  [4, 4, 4],
  [9, 3],
  [3, 6, 3],
]

/**
 * When a row has fewer tiles than its template (e.g. only one item left), pick spans
 * that sum to 12. Rotates pairs for variety when count === 2.
 * @param {number} count
 * @param {number} layoutRowIndex 0-based row index among non-full-width rows
 * @param {number[]} template  Preferred template for this row (may differ in length from count)
 * @returns {number[]}
 */
function spansForTileCount(count, layoutRowIndex, template) {
  if (count <= 0) return []
  if (count === template.length) return [...template]
  if (count === 1) return [BENTO_GRID_COLUMNS]

  if (count === 2) {
    const pairs = [
      [8, 4],
      [7, 5],
      [6, 6],
      [5, 7],
      [4, 8],
    ]
    return pairs[layoutRowIndex % pairs.length]
  }

  if (count === 3) return [4, 4, 4]

  if (count === 4) return [3, 3, 3, 3]

  const base = Math.floor(BENTO_GRID_COLUMNS / count)
  let rem = BENTO_GRID_COLUMNS - base * count
  return Array.from({ length: count }, () => {
    const extra = rem > 0 ? 1 : 0
    if (rem > 0) rem -= 1
    return base + extra
  })
}

/**
 * @param {string[]} orderedIds Section ids in display order (already filtered).
 * @returns {{ id: string, gridRow: number, gridColumn: string, colSpan: number, rowSpan: number }[]}
 */
export function computeBentoSpans(orderedIds) {
  const queue = [...orderedIds]
  /** @type {{ id: string, gridRow: number, gridColumn: string, colSpan: number, rowSpan: number }[]} */
  const out = []
  let gridRow = 1
  let templateCycle = 0
  /** Rows that only contain normal (non-full-width) tiles; for pair rotation. */
  let layoutRowIndex = 0

  while (queue.length > 0) {
    const peek = queue[0]
    if (FULL_WIDTH_IDS.has(peek)) {
      const id = queue.shift()
      out.push({
        id,
        gridRow,
        gridColumn: '1 / -1',
        colSpan: BENTO_GRID_COLUMNS,
        rowSpan: 1,
      })
      gridRow += 1
      continue
    }

    const template = ROW_TEMPLATES[templateCycle % ROW_TEMPLATES.length]
    templateCycle += 1

    const rowItems = []
    for (let i = 0; i < template.length && queue.length > 0; i++) {
      const head = queue[0]
      if (FULL_WIDTH_IDS.has(head)) break
      rowItems.push(queue.shift())
    }

    if (rowItems.length === 0) continue

    const spans = spansForTileCount(rowItems.length, layoutRowIndex, template)
    layoutRowIndex += 1

    let line = 1
    for (let i = 0; i < rowItems.length; i++) {
      const span = spans[i] ?? BENTO_GRID_COLUMNS
      const start = line
      const end = line + span
      out.push({
        id: rowItems[i],
        gridRow,
        gridColumn: `${start} / ${end}`,
        colSpan: span,
        rowSpan: 1,
      })
      line = end
    }

    gridRow += 1
  }

  return out
}

/** DOM id for scroll targets and IntersectionObserver (matches Settings page markup). */
export function settingsSectionDomId(sectionId) {
  return `settings-section-${sectionId}`
}
