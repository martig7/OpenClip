import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import {
  CELL_GAP, TOOLTIP_W, TOOLTIP_H, TOOLTIP_PAD,
  squarifiedTreemap, hexToRgba, drawRoundRect, buildHitIndex, hitTestIndex,
} from '../utils/treemapUtils'

/**
 * Canvas-rendered treemap visualization for storage items.
 * Manages its own zoom/pan, resize observation, and tooltip state.
 *
 * @param {object[]} items - Filtered/sorted list of recordings and clips
 * @param {Set<string>} selectedItems - Set of selected item paths
 * @param {function} onSelect - Called with (path) when an item is clicked
 * @param {Set<string>} lockedRecordings - Set of locked item paths
 * @param {function} onLock - Called with (event, path) when lock area is clicked
 * @param {object} gameColors - Map of game name → hex color
 * @param {function} onNavigate - Called with (item) on double-click
 */
export default function StorageTreemap({ items, selectedItems, onSelect, lockedRecordings, onLock, gameColors, onNavigate }) {
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [baseSize, setBaseSize] = useState({ w: 0, h: 0 })
  const [tooltip, setTooltip] = useState(null)

  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const layoutRef = useRef([])
  const selectedItemsRef = useRef(new Set())
  const lockedRef = useRef(new Set())
  const gameColorsRef = useRef({})
  const drawCanvasRef = useRef(null)
  const ctxRef = useRef(null)
  const hitIndexRef = useRef(null)
  const tooltipItemRef = useRef(null)
  const tooltipRafRef = useRef(null)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const dragHandlersRef = useRef({ move: null, up: null })

  // ResizeObserver — sizes the canvas to match its container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const sizeCanvas = (w, h) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctxRef.current = canvas.getContext('2d')
    }
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 10 && height > 10) {
        const w = Math.floor(width), h = Math.floor(height)
        setBaseSize({ w, h })
        sizeCanvas(w, h)
      }
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    if (r.width > 10) {
      const w = Math.floor(r.width), h = Math.floor(r.height)
      setBaseSize({ w, h })
      sizeCanvas(w, h)
    }
    return () => ro.disconnect()
  }, [])

  // Non-passive wheel: zoom toward cursor
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = e.deltaY > 0 ? 0.88 : 1.14
      const curZoom = zoomRef.current
      const curPan = panRef.current
      const newZoom = Math.max(0.5, Math.min(1000, curZoom * factor))
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const cx = (mouseX - curPan.x) / curZoom
      const cy = (mouseY - curPan.y) / curZoom
      const newPanX = mouseX - cx * newZoom
      const newPanY = mouseY - cy * newZoom
      zoomRef.current = newZoom
      panRef.current = { x: newPanX, y: newPanY }
      setZoom(newZoom)
      flushRedraw()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Cleanup drag handlers on unmount
  useEffect(() => {
    return () => {
      const { move, up } = dragHandlersRef.current
      if (move) window.removeEventListener('mousemove', move)
      if (up) window.removeEventListener('mouseup', up)
    }
  }, [])

  // Keep viewport ref in sync
  zoomRef.current = zoom

  // ── Canvas drawing ───────────────────────────────────────────────────────────
  function fillTextTruncated(ctx, text, x, y, maxWidth) {
    if (maxWidth <= 0) return
    if (ctx.measureText(text).width <= maxWidth) {
      ctx.fillText(text, x, y)
      return
    }
    const ellipsis = '\u2026'
    let lo = 0, hi = text.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid
      else hi = mid - 1
    }
    if (lo === 0) return
    ctx.fillText(text.slice(0, lo) + ellipsis, x, y)
  }

  drawCanvasRef.current = () => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.width || !canvas.height) return
    if (!ctxRef.current || ctxRef.current.canvas !== canvas) {
      ctxRef.current = canvas.getContext('2d')
    }
    const ctx = ctxRef.current
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.width / dpr
    const cssH = canvas.height / dpr

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, cssW, cssH)

    const layout = layoutRef.current
    const z = zoomRef.current
    const { x: px, y: py } = panRef.current
    const selected = selectedItemsRef.current
    const locked = lockedRef.current
    const colors = gameColorsRef.current

    if (!layout.length) {
      ctx.fillStyle = '#888'
      ctx.font = '14px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('No files match the current filter', cssW / 2, cssH / 2)
      ctx.restore()
      return
    }

    for (const item of layout) {
      const x = item.rx * z + px + CELL_GAP / 2
      const y = item.ry * z + py + CELL_GAP / 2
      const w = Math.max(0, item.rw * z - CELL_GAP)
      const h = Math.max(0, item.rh * z - CELL_GAP)
      if (w < 1 || h < 1) continue
      if (x + w < 0 || x > cssW || y + h < 0 || y > cssH) continue

      const color = colors[item.game_name] || '#888'
      const isSelected = selected.has(item.path)
      const isLocked = locked.has(item.path)
      const minDim = Math.min(w, h)

      ctx.fillStyle = isSelected ? hexToRgba(color, 0.14) : '#1e1e1e'
      drawRoundRect(ctx, x, y, w, h, Math.min(4, minDim / 4))
      ctx.fill()

      ctx.strokeStyle = isSelected ? color : isLocked ? '#f59e0b' : '#3a3a3a'
      ctx.lineWidth = isSelected ? 2 : 1
      ctx.stroke()

      const barH = Math.min(4, h)
      ctx.fillStyle = color
      ctx.fillRect(x, y, w, barH)

      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      if (minDim >= 52) {
        ctx.fillStyle = color
        ctx.font = 'bold 10px system-ui, sans-serif'
        fillTextTruncated(ctx, item.game_name, x + 5, y + 17, w - 28)
      }
      if (minDim >= 80) {
        ctx.fillStyle = '#999'
        ctx.font = '9px system-ui, sans-serif'
        fillTextTruncated(ctx, item.filename, x + 5, y + 29, w - 10)
        fillTextTruncated(ctx, item.size_formatted, x + 5, y + 41, w - 10)
      }

      if (isLocked && minDim >= 36) {
        const lx = x + w - 12, ly = y + 5, lw = 7, lh = 6, lr = 1.5
        ctx.fillStyle = '#f59e0b'
        ctx.beginPath()
        ctx.arc(lx + lw / 2, ly + 1, lw / 2 - 0.5, Math.PI, 0)
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#f59e0b'
        ctx.stroke()
        ctx.fillRect(lx, ly + lr, lw, lh)
      }

      if (isSelected) {
        const br = 8, bcx = x + br + 3, bcy = y + br + 3
        ctx.beginPath()
        ctx.arc(bcx, bcy, br, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 9px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('✓', bcx, bcy)
      }
    }
    ctx.restore()
  }

  const requestRedraw = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      drawCanvasRef.current()
    })
  }, [])

  const flushRedraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; drawCanvasRef.current() })
  }, [])

  // Layout — computed at base (zoom=1) dimensions; zoom applied via coordinate scaling
  const treemapLayout = useMemo(
    () => squarifiedTreemap(items, baseSize.w, baseSize.h),
    [items, baseSize.w, baseSize.h]
  )

  // Sync render-relevant state into refs and trigger canvas redraw
  useEffect(() => { layoutRef.current = treemapLayout; hitIndexRef.current = buildHitIndex(treemapLayout); requestRedraw() }, [treemapLayout, requestRedraw])
  useEffect(() => { selectedItemsRef.current = selectedItems; requestRedraw() }, [selectedItems, requestRedraw])
  useEffect(() => {
    lockedRef.current = new Set([...lockedRecordings].map(p => p.replace(/\\/g, '/')))
    requestRedraw()
  }, [lockedRecordings, requestRedraw])
  useEffect(() => { gameColorsRef.current = gameColors; requestRedraw() }, [gameColors, requestRedraw])
  useEffect(() => { requestRedraw() }, [zoom, requestRedraw])

  // Hit-test: canvas pixel → layout item (O(1) via spatial grid index)
  const getItemAt = useCallback((canvasX, canvasY) => {
    const z = zoomRef.current
    const { x: px, y: py } = panRef.current
    const lx = (canvasX - px) / z
    const ly = (canvasY - py) / z
    return hitTestIndex(hitIndexRef.current, lx, ly)
  }, [])

  const isLockArea = useCallback((item, canvasX, canvasY) => {
    const z = zoomRef.current
    const { x: px, y: py } = panRef.current
    const bx = item.rx * z + px + CELL_GAP / 2
    const by = item.ry * z + py + CELL_GAP / 2
    const bw = Math.max(0, item.rw * z - CELL_GAP)
    return canvasX >= bx + bw - 22 && canvasY >= by && canvasY <= by + 22
  }, [])

  const handleCanvasClick = useCallback((e) => {
    if (dragRef.current?.moved) return
    const rect = canvasRef.current.getBoundingClientRect()
    const item = getItemAt(e.clientX - rect.left, e.clientY - rect.top)
    if (!item) return
    if (isLockArea(item, e.clientX - rect.left, e.clientY - rect.top)) {
      onLock(e, item.path)
    } else {
      onSelect(item.path)
    }
  }, [getItemAt, isLockArea, onLock, onSelect])

  const handleCanvasDblClick = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const item = getItemAt(e.clientX - rect.left, e.clientY - rect.top)
    if (item) onNavigate(item)
  }, [getItemAt, onNavigate])

  const handleCanvasMouseMove = useCallback((e) => {
    if (tooltipRafRef.current) return
    tooltipRafRef.current = requestAnimationFrame(() => {
      tooltipRafRef.current = null
      if (!canvasRef.current) return
      const rect = canvasRef.current.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const item = getItemAt(cx, cy)
      const newPath = item ? item.path : null
      if (newPath === tooltipItemRef.current) return
      tooltipItemRef.current = newPath
      if (item) {
        const isLocked = lockedRef.current.has(item.path)
        setTooltip({
          x: e.clientX, y: e.clientY,
          text: `${item.game_name} · ${item.filename}\n${item.size_formatted} · ${item.date}${isLocked ? ' · [Locked]' : ''}`
        })
      } else {
        setTooltip(null)
      }
    })
  }, [getItemAt])

  const tooltipPos = useMemo(() => {
    if (!tooltip) return null
    return {
      left: Math.min(tooltip.x + TOOLTIP_PAD, window.innerWidth  - TOOLTIP_W - TOOLTIP_PAD),
      top:  Math.min(tooltip.y + TOOLTIP_PAD, window.innerHeight - TOOLTIP_H - TOOLTIP_PAD),
    }
  }, [tooltip])

  const zoomBy = useCallback((factor) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const anchorX = rect.width / 2
    const anchorY = rect.height / 2
    const curZoom = zoomRef.current
    const curPan = panRef.current
    const newZoom = Math.max(0.5, Math.min(1000, curZoom * factor))
    const cx = (anchorX - curPan.x) / curZoom
    const cy = (anchorY - curPan.y) / curZoom
    const newPanX = anchorX - cx * newZoom
    const newPanY = anchorY - cy * newZoom
    zoomRef.current = newZoom
    panRef.current = { x: newPanX, y: newPanY }
    setZoom(newZoom)
    flushRedraw()
  }, [flushRedraw])

  return (
    <div
      className={`sv2-treemap-container${isDragging ? ' dragging' : ''}`}
      ref={containerRef}
      onMouseDown={e => {
        if (e.button !== 0) return
        dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panRef.current.x, startPanY: panRef.current.y, moved: false }
        const onMove = (me) => {
          const dx = me.clientX - dragRef.current.startX
          const dy = me.clientY - dragRef.current.startY
          if (!dragRef.current.moved && Math.hypot(dx, dy) > 4) {
            dragRef.current.moved = true
            setIsDragging(true)
          }
          if (dragRef.current.moved) {
            panRef.current = { x: dragRef.current.startPanX + dx, y: dragRef.current.startPanY + dy }
            flushRedraw()
          }
        }
        const onUp = () => {
          const wasDrag = dragRef.current?.moved
          dragRef.current = null
          setIsDragging(false)
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          dragHandlersRef.current = { move: null, up: null }
          if (wasDrag) window.addEventListener('click', e => e.stopPropagation(), { capture: true, once: true })
        }
        dragHandlersRef.current = { move: onMove, up: onUp }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }}
    >
      <canvas
        ref={canvasRef}
        className="sv2-canvas"
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDblClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={() => {
          if (tooltipRafRef.current) { cancelAnimationFrame(tooltipRafRef.current); tooltipRafRef.current = null }
          tooltipItemRef.current = null
          setTooltip(null)
        }}
      />
      <div className="sv2-zoom-ctrl">
        <button onClick={() => zoomBy(0.8)} title="Zoom out"><ZoomOut size={13} /></button>
        <button
          className="sv2-zoom-pct"
          onClick={() => { setZoom(1); zoomRef.current = 1; panRef.current = { x: 0, y: 0 }; flushRedraw() }}
          title="Reset view"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => zoomBy(1.25)} title="Zoom in"><ZoomIn size={13} /></button>
      </div>
      {tooltipPos && (
        <div className="sv2-tooltip" style={{ left: tooltipPos.left, top: tooltipPos.top }}>
          {tooltip.text.split('\n').map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  )
}
