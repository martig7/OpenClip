import { useEffect, useCallback, useRef } from 'react'

const HEADER_H = 30
const ROW_H = 33
const SB_W = 8

const COL_COLOR = 28
const COL_GAME = 120
const COL_TYPE = 88
const COL_DATE = 128
const COL_SIZE = 76
const COL_ACT = 50

function getLayout(cssW) {
  const fixed = COL_COLOR + COL_GAME + COL_TYPE + COL_DATE + COL_SIZE + COL_ACT + SB_W
  const nameW = Math.max(80, cssW - fixed)
  const xName = COL_COLOR
  return {
    xColor: 0,
    xName,
    nameW,
    xGame: xName + nameW,
    xType: xName + nameW + COL_GAME,
    xDate: xName + nameW + COL_GAME + COL_TYPE,
    xSize: xName + nameW + COL_GAME + COL_TYPE + COL_DATE,
    xAct: xName + nameW + COL_GAME + COL_TYPE + COL_DATE + COL_SIZE,
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

function lockIcon(ctx, cx, cy, sz, locked, color) {
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  const ox = locked ? 0 : sz * 0.12
  ctx.beginPath()
  ctx.arc(cx + ox, cy - sz * 0.15, sz * 0.28, Math.PI, 0)
  ctx.stroke()
  const bw = sz * 0.65,
    bh = sz * 0.5
  ctx.beginPath()
  ctx.roundRect(cx - bw / 2, cy - sz * 0.05, bw, bh, 2)
  ctx.fill()
}

export default function StorageList({
  items,
  selectedItems,
  onSelect,
  lockedRecordings,
  onLock,
  gameColors,
  onNavigate,
  sortBy,
  sortDir,
  onColumnSort,
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const drawRef = useRef(null)
  const scrollRef = useRef(0)
  const hoverRef = useRef(-1)
  const sizeRef = useRef({ w: 0, h: 0 })
  const dragSbRef = useRef(null)
  const moveRafRef = useRef(null)

  // Latest props in refs: avoids stale closures in draw/event handlers
  const itemsRef = useRef(items)
  const selRef = useRef(selectedItems)
  const lockedRef = useRef(lockedRecordings)
  const colorsRef = useRef(gameColors)
  const sortByRef = useRef(sortBy)
  const sortDirRef = useRef(sortDir)

  itemsRef.current = items
  selRef.current = selectedItems
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
    scheduleDraw()
  }, [items, selectedItems, gameColors, sortBy, sortDir, scheduleDraw])
  useEffect(() => {
    lockedRef.current = new Set([...lockedRecordings].map((p) => p.replace(/\\/g, '/')))
    scheduleDraw()
  }, [lockedRecordings, scheduleDraw])

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
    const locked = lockedRef.current
    const gc = colorsRef.current
    const st = scrollRef.current
    const hover = hoverRef.current
    const L = getLayout(w)

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    // Header background
    ctx.fillStyle = '#181818'
    ctx.fillRect(0, 0, w, HEADER_H)
    ctx.fillStyle = '#333333'
    ctx.fillRect(0, HEADER_H - 1, w, 1)

    // Header columns
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const hCols = [
      { key: 'name', label: 'NAME', x: L.xName },
      { key: 'game', label: 'GAME', x: L.xGame },
      { key: null, label: 'TYPE', x: L.xType },
      { key: 'date', label: 'DATE', x: L.xDate },
      { key: 'size', label: 'SIZE', x: L.xSize },
    ]
    for (const col of hCols) {
      const active = col.key === sortByRef.current
      ctx.fillStyle = active ? '#a78bfa' : '#666666'
      ctx.font = '600 10px system-ui, sans-serif'
      ctx.fillText(col.label, col.x + 10, HEADER_H / 2)
      if (col.key) {
        const tw = ctx.measureText(col.label).width
        const cx = col.x + 10 + tw + 7,
          cy = HEADER_H / 2
        ctx.strokeStyle = active ? '#a78bfa' : '#444444'
        ctx.lineWidth = 1.5
        if (!active) {
          chevron(ctx, cx, cy - 2.5, 5, true)
          chevron(ctx, cx, cy + 2.5, 5, false)
        } else chevron(ctx, cx, cy, 7, sortDirRef.current === 'asc')
      }
    }

    // Clip to row area
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
      const isSel = sel.has(item.path)
      const isLk = locked.has(item.path.replace(/\\/g, '/'))
      const color = gc[item.game_name] || '#888888'
      const isHov = i === hover

      // Row background
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

      ctx.globalAlpha = isLk ? 0.55 : 1

      // Color dot / selected indicator
      if (isSel) {
        ctx.fillStyle = '#7c3aed'
        ctx.beginPath()
        ctx.arc(L.xColor + 14, y + ROW_H / 2, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(L.xColor + 11, y + ROW_H / 2)
        ctx.lineTo(L.xColor + 13.5, y + ROW_H / 2 + 2.5)
        ctx.lineTo(L.xColor + 17, y + ROW_H / 2 - 3)
        ctx.stroke()
      } else {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(L.xColor + 14, y + ROW_H / 2, 3.5, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'

      // Name
      ctx.fillStyle = '#ffffff'
      ctx.font = '12px system-ui, sans-serif'
      truncText(ctx, item.filename, L.xName + 10, y + ROW_H / 2, L.nameW - 20)

      // Game
      ctx.fillStyle = color
      ctx.font = '11px system-ui, sans-serif'
      truncText(ctx, item.game_name, L.xGame + 8, y + ROW_H / 2, COL_GAME - 16)

      // Type
      ctx.fillStyle = '#888888'
      ctx.font = '11px system-ui, sans-serif'
      ctx.fillText(item.type === 'clip' ? 'Clip' : 'Rec', L.xType + 8, y + ROW_H / 2)

      // Date
      ctx.fillStyle = '#aaaaaa'
      truncText(ctx, item.date || '', L.xDate + 8, y + ROW_H / 2, COL_DATE - 16)

      // Size
      ctx.fillStyle = '#aaaaaa'
      ctx.font = '11px "Courier New", monospace'
      truncText(ctx, item.size_formatted || '', L.xSize + 8, y + ROW_H / 2, COL_SIZE - 8)

      // Lock icon: always full opacity so yellow shows clearly
      ctx.globalAlpha = 1
      if (isLk) {
        lockIcon(ctx, L.xAct + COL_ACT / 2, y + ROW_H / 2, 11, true, '#f59e0b')
      } else if (isHov) {
        ctx.globalAlpha = 0.4
        lockIcon(ctx, L.xAct + COL_ACT / 2, y + ROW_H / 2, 11, false, '#aaaaaa')
        ctx.globalAlpha = 1
      }
    }
    ctx.restore()

    // Scrollbar
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

  const hitHeader = useCallback((cy) => {
    const rect = containerRef.current?.getBoundingClientRect()
    return rect ? cy - rect.top < HEADER_H : false
  }, [])

  const hitSortCol = useCallback((cx) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return null
    const x = cx - rect.left
    const L = getLayout(sizeRef.current.w)
    if (x < L.xName) return null
    if (x < L.xGame) return 'name'
    if (x < L.xType) return 'game'
    if (x < L.xDate) return null // type (not sortable)
    if (x < L.xSize) return 'date'
    if (x < L.xAct) return 'size'
    return null
  }, [])

  const hitLock = useCallback((cx) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return false
    return cx - rect.left >= getLayout(sizeRef.current.w).xAct
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

  // ── Click / dblclick ─────────────────────────────────────────────────────────
  const handleClick = useCallback(
    (e) => {
      if (dragSbRef.current) return
      if (hitHeader(e.clientY)) {
        const col = hitSortCol(e.clientX)
        if (col) onColumnSort(col)
        return
      }
      const row = hitRow(e.clientY)
      if (row < 0) return
      const item = itemsRef.current[row]
      if (hitLock(e.clientX)) onLock(e, item.path)
      else onSelect(item.path)
    },
    [hitHeader, hitSortCol, hitRow, hitLock, onColumnSort, onLock, onSelect]
  )

  const handleDblClick = useCallback(
    (e) => {
      if (hitHeader(e.clientY)) return
      const row = hitRow(e.clientY)
      if (row >= 0) onNavigate(itemsRef.current[row])
    },
    [hitHeader, hitRow, onNavigate]
  )

  // ── Mouse move / leave ───────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e) => {
      if (moveRafRef.current) return
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null
        const inHeader = hitHeader(e.clientY)
        const row = inHeader ? -1 : hitRow(e.clientY)
        if (containerRef.current) {
          const pointer = (inHeader && hitSortCol(e.clientX)) || row >= 0
          containerRef.current.style.cursor = pointer ? 'pointer' : 'default'
        }
        if (row !== hoverRef.current) {
          hoverRef.current = row
          scheduleDraw()
        }
      })
    },
    [hitHeader, hitRow, hitSortCol, scheduleDraw]
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

  return (
    <div
      ref={containerRef}
      className="sv2-list-canvas-wrap"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDblClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={canvasRef} className="sv2-canvas" />
    </div>
  )
}
