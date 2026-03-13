/**
 * Squarified treemap algorithm (Bruls, Huizing & van Wijk) and
 * canvas rendering helpers for the StoragePage treemap visualization.
 */

export const CELL_GAP = 2  // px gap between cells
export const MIN_DIM = 36  // px — minimum width or height for any cell; prevents hair-thin slivers

// Tooltip sizing constants — kept in sync with the .sv2-tooltip CSS rule (max-width: 280px)
export const TOOLTIP_W = 280  // matches CSS max-width
export const TOOLTIP_H = 56   // conservative height estimate for two lines of text
export const TOOLTIP_PAD = 14 // gap between cursor and tooltip corner

// ── Squarified treemap ────────────────────────────────────────────────────────
// Worst aspect ratio for a candidate row given the short side of the current rect.
function _worstRatio(row, shortSide) {
  const s = row.reduce((a, d) => a + d._area, 0)
  const max = Math.max(...row.map(d => d._area))
  const min = Math.min(...row.map(d => d._area))
  return Math.max(
    (shortSide * shortSide * max) / (s * s),
    (s * s) / (shortSide * shortSide * Math.max(min, 1e-10))
  )
}

function _squarify(items, x, y, w, h, out) {
  if (!items.length || w < 1 || h < 1) {
    if (items.length && w >= 1 && h >= 1) {
      const isWide = w >= h
      items.forEach((item, i) => {
        if (isWide) {
          out.push({ ...item, rx: x + w * i / items.length, ry: y, rw: w / items.length, rh: h })
        } else {
          out.push({ ...item, rx: x, ry: y + h * i / items.length, rw: w, rh: h / items.length })
        }
      })
    }
    return
  }
  if (items.length === 1) { out.push({ ...items[0], rx: x, ry: y, rw: w, rh: h }); return }

  const isWide = w >= h
  const short = Math.min(w, h)

  let row = [items[0]]
  for (let i = 1; i < items.length; i++) {
    const candidate = [...row, items[i]]
    if (row.length >= 1 && _worstRatio(candidate, short) > _worstRatio(row, short)) break
    row = candidate
  }

  const rowArea = row.reduce((a, d) => a + d._area, 0)
  const depth = rowArea / short
  let off = 0
  for (const item of row) {
    const len = (item._area / rowArea) * short
    if (isWide) out.push({ ...item, rx: x,       ry: y + off, rw: depth, rh: len })
    else        out.push({ ...item, rx: x + off,  ry: y,       rw: len,   rh: depth })
    off += len
  }

  const rest = items.slice(row.length)
  if (isWide) _squarify(rest, x + depth, y, Math.max(0, w - depth), h, out)
  else        _squarify(rest, x, y + depth, w, Math.max(0, h - depth), out)
}

/**
 * Compute a squarified treemap layout for the given items within a w×h rectangle.
 * Each output item has rx, ry, rw, rh fields (in pixels) plus all original item fields.
 */
export function squarifiedTreemap(items, w, h) {
  if (!items.length || !w || !h) return []
  const total = items.reduce((a, i) => a + i.size_bytes, 0)
  if (!total) return []
  const totalArea = w * h
  const minArea = MIN_DIM * MIN_DIM
  const rawAreas = items.map(item => (item.size_bytes / total) * totalArea)
  const floored = rawAreas.map(a => Math.max(a, minArea))
  const scale = totalArea / floored.reduce((s, a) => s + a, 0)
  const nodes = items.map((item, i) => ({ ...item, _area: floored[i] * scale }))
  const out = []
  _squarify(nodes, 0, 0, w, h, out)
  return out
}

// ── Canvas rendering helpers ──────────────────────────────────────────────────
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function drawRoundRect(ctx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ── Spatial grid index for O(1) hit-testing ──────────────────────────────────
// Divides base-space layout into GRID_CELLS×GRID_CELLS buckets.
const GRID_CELLS = 16

export function buildHitIndex(layout) {
  if (!layout.length) return null
  let maxX = 0, maxY = 0
  for (const item of layout) {
    if (item.rx + item.rw > maxX) maxX = item.rx + item.rw
    if (item.ry + item.rh > maxY) maxY = item.ry + item.rh
  }
  const cellW = maxX / GRID_CELLS
  const cellH = maxY / GRID_CELLS
  const buckets = Array.from({ length: GRID_CELLS * GRID_CELLS }, () => [])
  for (const item of layout) {
    const c0 = Math.max(0, Math.floor(item.rx / cellW))
    const c1 = Math.min(GRID_CELLS - 1, Math.floor((item.rx + item.rw) / cellW))
    const r0 = Math.max(0, Math.floor(item.ry / cellH))
    const r1 = Math.min(GRID_CELLS - 1, Math.floor((item.ry + item.rh) / cellH))
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        buckets[r * GRID_CELLS + c].push(item)
      }
    }
  }
  return { buckets, cellW, cellH, maxX, maxY }
}

export function hitTestIndex(index, lx, ly) {
  if (!index) return null
  if (lx < 0 || ly < 0 || lx > index.maxX || ly > index.maxY) return null
  const col = Math.min(GRID_CELLS - 1, Math.floor(lx / index.cellW))
  const row = Math.min(GRID_CELLS - 1, Math.floor(ly / index.cellH))
  const bucket = index.buckets[row * GRID_CELLS + col]
  for (const item of bucket) {
    if (lx >= item.rx && lx <= item.rx + item.rw &&
        ly >= item.ry && ly <= item.ry + item.rh) return item
  }
  return null
}
