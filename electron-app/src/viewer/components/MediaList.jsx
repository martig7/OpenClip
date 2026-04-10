import { useEffect, useCallback, useRef } from 'react'

const HEADER_H = 26
const ROW_H = 33
const SB_W = 8

const COL_DOT = 22

function getLayout(cssW) {
  const MIN_DATE = 70
  const MIN_SIZE = 52
  const MAX_DATE = 140
  const MAX_SIZE = 80

  const extra = Math.max(0, cssW - 280)
  const colDate = Math.min(MAX_DATE, MIN_DATE + extra * 0.45)
  const colSize = Math.min(MAX_SIZE, MIN_SIZE + extra * 0.15)

  const nameW = Math.max(60, cssW - COL_DOT - colDate - colSize - SB_W)
  return {
    xDot: 0,
    xName: COL_DOT,
    nameW,
    xDate: COL_DOT + nameW,
    colDate,
    xSize: COL_DOT + nameW + colDate,
    colSize,
  }
}

function truncText(ctx, text, x, y, maxW) {
  if (maxW <= 4 || !text) return
  if (ctx.measureText(text).width <= maxW) {
    ctx.fillText(text, x, y)
    return
  }
  let lo = 0,
    hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    ctx.measureText(text.slice(0, mid) + '…').width <= maxW ? (lo = mid) : (hi = mid - 1)
  }
  if (lo > 0) ctx.fillText(text.slice(0, lo) + '…', x, y)
}

function chevron(ctx, cx, cy, sz, up) {
  ctx.beginPath()
  ctx.moveTo(cx - sz / 2, up ? cy + sz / 3 : cy - sz / 3)
  ctx.lineTo(cx, up ? cy - sz / 3 : cy + sz / 3)
  ctx.lineTo(cx + sz / 2, up ? cy + sz / 3 : cy - sz / 3)
  ctx.stroke()
}

export default function MediaList({ items, selectedItem, onSelect, gameColors, sortBy, sortDir }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const drawRef = useRef(null)
  const scrollRef = useRef(0)
  const hoverRef = useRef(-1)
  const sizeRef = useRef({ w: 0, h: 0 })
  const dragSbRef = useRef(null)
  const moveRafRef = useRef(null)

  // Mirror props to refs: prevents stale closures in draw/event handlers
  const itemsRef = useRef(items)
  const selRef = useRef(selectedItem) // holds full item Object, not a Set
  const colorsRef = useRef(gameColors)
  const sortByRef = useRef(sortBy)
  const sortDirRef = useRef(sortDir)

  itemsRef.current = items
  selRef.current = selectedItem
  colorsRef.current = gameColors
  sortByRef.current = sortBy
  sortDirRef.current = sortDir

  const clamp = useCallback((v) => {
    const { h } = sizeRef.current
    return Math.max(0, Math.min(Math.max(0, itemsRef.current.length * ROW_H - (h - HEADER_H)), v))
  }, [])

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      drawRef.current?.()
    })
  }, [])

  const flushDraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      drawRef.current?.()
    })
  }, [])

  // ── Resize observer ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const sync = (w, h) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      sizeRef.current = { w, h }
      scheduleDraw()
    }
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      if (width > 10 && height > 10) sync(Math.floor(width), Math.floor(height))
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    if (r.width > 10) sync(Math.floor(r.width), Math.floor(r.height))
    return () => ro.disconnect()
  }, [scheduleDraw])

  // ── Wheel ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      scrollRef.current = clamp(scrollRef.current + e.deltaY)
      flushDraw()
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [clamp, flushDraw])

  // ── Redraw on prop changes ───────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current = clamp(scrollRef.current)
    scheduleDraw()
  }, [items, selectedItem, gameColors, sortBy, sortDir, clamp, scheduleDraw])

  // ── Canvas draw ──────────────────────────────────────────────────────────────
  drawRef.current = () => {
    const canvas = canvasRef.current
    if (!canvas?.width) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const { w, h } = sizeRef.current
    if (!w || !h) return

    const items = itemsRef.current
    const sel = selRef.current
    const gc = colorsRef.current
    const st = scrollRef.current
    const hover = hoverRef.current
    const L = getLayout(w)

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    // ── Header ──────────────────────────────────────────────────────────────
    ctx.fillStyle = '#181818'
    ctx.fillRect(0, 0, w, HEADER_H)
    ctx.fillStyle = '#333333'
    ctx.fillRect(0, HEADER_H - 1, w, 1)

    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const hCols = [
      { key: 'name', label: 'NAME', x: L.xName },
      { key: 'date', label: 'DATE', x: L.xDate },
      { key: 'size', label: 'SIZE', x: L.xSize },
    ]
    for (const col of hCols) {
      const active = col.key === sortByRef.current
      ctx.fillStyle = active ? '#a78bfa' : '#444444'
      ctx.font = '600 10px system-ui, sans-serif'
      ctx.fillText(col.label, col.x + 8, HEADER_H / 2)
      if (active) {
        const tw = ctx.measureText(col.label).width
        const cx = col.x + 8 + tw + 6
        const cy = HEADER_H / 2
        ctx.strokeStyle = '#a78bfa'
        ctx.lineWidth = 1.5
        chevron(ctx, cx, cy, 7, sortDirRef.current === 'asc')
      }
    }

    // ── Rows ─────────────────────────────────────────────────────────────────
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, HEADER_H, w, h - HEADER_H)
    ctx.clip()

    const rowsH = h - HEADER_H
    const r0 = Math.max(0, Math.floor(st / ROW_H))
    const r1 = Math.min(items.length, Math.ceil((st + rowsH) / ROW_H))

    for (let i = r0; i < r1; i++) {
      const item = items[i]
      const y = HEADER_H + i * ROW_H - st
      const isSel = item.path === sel?.path
      const color = gc[item.game_name] || '#888888'
      const isHov = i === hover

      // Row background: no globalAlpha changes, always full opacity
      if (isSel) {
        ctx.fillStyle = 'rgba(99,102,241,0.1)'
        ctx.fillRect(0, y, w, ROW_H)
      } else if (isHov) {
        ctx.fillStyle = '#2a2a2a'
        ctx.fillRect(0, y, w, ROW_H)
      }

      // Row border
      ctx.fillStyle = '#333333'
      ctx.fillRect(0, y + ROW_H - 1, w, 1)

      // Dot / selected indicator (center: xDot+11, y+ROW_H/2)
      const dotCx = L.xDot + 11
      const dotCy = y + ROW_H / 2
      if (isSel) {
        ctx.fillStyle = '#7c3aed'
        ctx.beginPath()
        ctx.arc(dotCx, dotCy, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(dotCx - 3, dotCy)
        ctx.lineTo(dotCx - 0.5, dotCy + 2.5)
        ctx.lineTo(dotCx + 4, dotCy - 3)
        ctx.stroke()
      } else {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(dotCx, dotCy, 3.5, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'

      // Name
      ctx.fillStyle = '#ffffff'
      ctx.font = '12px system-ui, sans-serif'
      truncText(ctx, item.filename, L.xName + 8, y + ROW_H / 2, L.nameW - 16)

      // Date
      ctx.fillStyle = '#555555'
      ctx.font = '11px system-ui, sans-serif'
      truncText(ctx, item.date || '', L.xDate + 8, y + ROW_H / 2, L.colDate - 12)

      // Size
      ctx.fillStyle = '#555555'
      ctx.font = '11px "Courier New", monospace'
      truncText(ctx, item.size_formatted || '', L.xSize + 8, y + ROW_H / 2, L.colSize - 8)
    }
    ctx.restore()

    // ── Scrollbar ────────────────────────────────────────────────────────────
    const totalH = items.length * ROW_H
    const rowsVis = h - HEADER_H
    if (totalH > rowsVis) {
      const thumbH = Math.max(24, (rowsVis * rowsVis) / totalH)
      const thumbY = HEADER_H + (st / (totalH - rowsVis)) * (rowsVis - thumbH)
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.fillRect(w - SB_W, HEADER_H, SB_W, rowsVis)
      ctx.fillStyle = 'rgba(255,255,255,0.22)'
      ctx.beginPath()
      ctx.roundRect(w - SB_W + 1, thumbY, SB_W - 2, thumbH, 2)
      ctx.fill()
    }

    ctx.restore()
  }

  // ── Hit testing ──────────────────────────────────────────────────────────────
  const hitRow = useCallback((cy) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return -1
    const y = cy - rect.top
    if (y < HEADER_H) return -1
    const i = Math.floor((y - HEADER_H + scrollRef.current) / ROW_H)
    return i >= 0 && i < itemsRef.current.length ? i : -1
  }, [])

  const hitScrollbar = useCallback((cx) => {
    const rect = containerRef.current?.getBoundingClientRect()
    return rect ? cx - rect.left >= sizeRef.current.w - SB_W : false
  }, [])

  // ── Scrollbar drag ───────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e) => {
      if (e.button !== 0 || !hitScrollbar(e.clientX)) return
      const { h } = sizeRef.current
      const rowsH = h - HEADER_H
      const totalH = itemsRef.current.length * ROW_H
      if (totalH <= rowsH) return
      e.preventDefault()
      dragSbRef.current = { startY: e.clientY, startScroll: scrollRef.current, rowsH, totalH }
      const onMove = (me) => {
        if (!dragSbRef.current) return
        const { startY, startScroll, rowsH, totalH } = dragSbRef.current
        const thumbH = Math.max(24, (rowsH * rowsH) / totalH)
        const trackH = rowsH - thumbH
        const ratio = trackH > 0 ? (me.clientY - startY) / trackH : 0
        scrollRef.current = clamp(startScroll + ratio * (totalH - rowsH))
        flushDraw()
      }
      const onUp = () => {
        dragSbRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [clamp, flushDraw, hitScrollbar]
  )

  // ── Click ─────────────────────────────────────────────────────────────────────
  const handleClick = useCallback(
    (e) => {
      if (dragSbRef.current) return
      const row = hitRow(e.clientY)
      if (row < 0) return
      onSelect(itemsRef.current[row])
    },
    [hitRow, onSelect]
  )

  // ── Mouse move / leave ───────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e) => {
      if (moveRafRef.current) return
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null
        const row = hitRow(e.clientY)
        if (containerRef.current) {
          containerRef.current.style.cursor = row >= 0 ? 'pointer' : 'default'
        }
        if (row !== hoverRef.current) {
          hoverRef.current = row
          scheduleDraw()
        }
      })
    },
    [hitRow, scheduleDraw]
  )

  const handleMouseLeave = useCallback(() => {
    if (moveRafRef.current) {
      cancelAnimationFrame(moveRafRef.current)
      moveRafRef.current = null
    }
    hoverRef.current = -1
    if (containerRef.current) containerRef.current.style.cursor = 'default'
    scheduleDraw()
  }, [scheduleDraw])

  // In test mode, render a plain DOM list so e2e tests can query by text/class.
  // Triggered by window.api.testMode (Electron --test-mode) or window.__OPENCLIP_TEST_MODE__
  // (injected by Playwright addInitScript when running against the Vite dev server).
  if (typeof window !== 'undefined' && (window.api?.testMode || window.__OPENCLIP_TEST_MODE__)) {
    return (
      <ul className="media-list-test">
        {items.map((item) => (
          <li
            key={item.path}
            className={`item-card${item.path === selectedItem?.path ? ' active' : ''}`}
            data-path={item.path}
            onClick={() => onSelect(item)}
          >
            <span className="item-name">{item.filename}</span>
            <span className="item-game">{item.game_name}</span>
            <span className="item-date">{item.date}</span>
            <span className="item-size">{item.size_formatted}</span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}
