import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { HardDrive, Film, Trash2, Save, Info, Loader, Package, Check, X, ZoomIn, ZoomOut, Filter } from 'lucide-react'
import Modal from '../components/Modal'
import { apiFetch, apiPost } from '../apiBase'

const GAME_PALETTE = [
  '#7c3aed', // violet-700
  '#3b82f6', // blue-500
  '#06b6d4', // cyan-500
  '#6366f1', // indigo-500
  '#8b5cf6', // violet-500
  '#0ea5e9', // sky-500
  '#a78bfa', // violet-400
  '#818cf8', // indigo-400
  '#2dd4bf', // teal-400
  '#c084fc', // purple-400
  '#60a5fa', // blue-400
  '#22d3ee', // cyan-400
  '#4f46e5', // indigo-600
  '#7e22ce', // purple-700
  '#0284c7', // sky-600
  '#0891b2', // cyan-600
]

const CELL_GAP = 2  // px gap between cells
const MIN_DIM = 36  // px — minimum width or height for any cell; prevents hair-thin slivers

// ── Squarified treemap (Bruls, Huizing & van Wijk) ───────────────────────────
// Worst aspect ratio for a candidate row given the short side of the current rect.
// Uses the closed-form from the paper: worst = max(w²·max/s², s²/(w²·min))
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
    // Degenerate: stack remaining items as thin slices
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

  // Grow the row until adding the next item worsens the worst ratio
  let row = [items[0]]
  for (let i = 1; i < items.length; i++) {
    const candidate = [...row, items[i]]
    if (row.length >= 1 && _worstRatio(candidate, short) > _worstRatio(row, short)) break
    row = candidate
  }

  // Commit row: strip depth = rowArea / shortSide
  const rowArea = row.reduce((a, d) => a + d._area, 0)
  const depth = rowArea / short
  let off = 0
  for (const item of row) {
    const len = (item._area / rowArea) * short
    if (isWide) out.push({ ...item, rx: x,       ry: y + off, rw: depth, rh: len })
    else        out.push({ ...item, rx: x + off,  ry: y,       rw: len,   rh: depth })
    off += len
  }

  // Recurse into remaining rectangle
  const rest = items.slice(row.length)
  if (isWide) _squarify(rest, x + depth, y, Math.max(0, w - depth), h, out)
  else        _squarify(rest, x, y + depth, w, Math.max(0, h - depth), out)
}

function squarifiedTreemap(items, w, h) {
  if (!items.length || !w || !h) return []
  const total = items.reduce((a, i) => a + i.size_bytes, 0)
  if (!total) return []
  const totalArea = w * h
  const minArea = MIN_DIM * MIN_DIM
  // Floor areas so no cell is narrower than MIN_DIM in either dimension,
  // then renormalise so all areas still sum to totalArea.
  const rawAreas = items.map(item => (item.size_bytes / total) * totalArea)
  const floored = rawAreas.map(a => Math.max(a, minArea))
  const scale = totalArea / floored.reduce((s, a) => s + a, 0)
  const nodes = items.map((item, i) => ({ ...item, _area: floored[i] * scale }))
  const out = []
  _squarify(nodes, 0, 0, w, h, out)
  return out
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Canvas rendering helpers ─────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function drawRoundRect(ctx, x, y, w, h, r) {
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

// Normalise file path separators to backslashes for locked-recordings Set lookups (Windows paths)
function normPath(p) { return p.replace(/\//g, '\\') }

function StoragePage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [settings, setSettings] = useState(null)
  const [editedSettings, setEditedSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedItems, setSelectedItems] = useState(new Set())
  const [deleteModal, setDeleteModal] = useState(false)
  const [reencodeModal, setReencodeModal] = useState(false)
  const [reencodeSettings, setReencodeSettings] = useState({
    codec: 'h265', crf: 23, preset: 'medium', replaceOriginal: false
  })
  const [isReencoding, setIsReencoding] = useState(false)
  const [reencodeProgress, setReencodeProgress] = useState({ current: 0, total: 0, currentFile: '' })
  const [reencodeAudioTracks, setReencodeAudioTracks] = useState([])
  const [reencodeSelectedTracks, setReencodeSelectedTracks] = useState([])
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [toast, setToast] = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [filterGame, setFilterGame] = useState('all')
  const [sortBy, setSortBy] = useState('date')
  const [lockedRecordings, setLockedRecordings] = useState(new Set())
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [baseSize, setBaseSize] = useState({ w: 0, h: 0 })
  const [tooltip, setTooltip] = useState(null)
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const layoutRef = useRef([])
  const selectedItemsRef = useRef(new Set())
  const lockedRef = useRef(new Set())
  const gameColorsRef = useRef({})
  // Holds the latest drawCanvas closure so hot-path handlers always call the up-to-date version
  const drawCanvasRef = useRef(null)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef(null)

  const fetchStats = useCallback(async () => {
    try {
      const response = await apiFetch('/api/storage/stats')
      const data = await response.json()
      setStats(data)
      setLockedRecordings(new Set(data.locked_recordings || []))
    } catch (error) {
      console.error('Failed to fetch storage stats:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      const response = await apiFetch('/api/storage/settings')
      const data = await response.json()
      setSettings(data)
      setEditedSettings(data)
    } catch (error) {
      console.error('Failed to fetch storage settings:', error)
    }
  }, [])

  useEffect(() => {
    fetchStats()
    fetchSettings()
  }, [fetchStats, fetchSettings])

  // ResizeObserver for treemap container — also sizes the canvas to match
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const sizeCanvas = (w, h) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = w * dpr
      canvas.height = h * dpr
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
  }, [loading])

  // Non-passive wheel: zoom toward cursor (map-style); reads refs for fresh values
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = e.deltaY > 0 ? 0.88 : 1.14
      const curZoom = zoomRef.current
      const curPan = panRef.current
      const newZoom = Math.max(0.5, Math.min(5, curZoom * factor))
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const cx = (mouseX - curPan.x) / curZoom
      const cy = (mouseY - curPan.y) / curZoom
      const newPanX = mouseX - cx * newZoom
      const newPanY = mouseY - cy * newZoom
      zoomRef.current = newZoom
      panRef.current = { x: newPanX, y: newPanY }
      setZoom(newZoom)
      // Redraw canvas directly via RAF without waiting for React render cycle
      flushRedraw()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [loading])

  const showToast = useCallback((type, message) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const toggleSelection = useCallback((path) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(path)) newSet.delete(path)
      else newSet.add(path)
      return newSet
    })
  }, [])

  const toggleLock = useCallback(async (e, path) => {
    e.stopPropagation()
    const normalizedPath = normPath(path)
    const isLocked = lockedRecordings.has(normalizedPath)
    try {
      const response = await apiPost('/api/storage/lock', { path, locked: !isLocked })
      if (response.ok) {
        setLockedRecordings(prev => {
          const newSet = new Set(prev)
          if (isLocked) newSet.delete(normalizedPath)
          else newSet.add(normalizedPath)
          return newSet
        })
        showToast('success', isLocked ? 'Recording unlocked' : 'Recording locked')
      }
    } catch {
      showToast('error', 'Failed to toggle lock')
    }
  }, [lockedRecordings, showToast])

  const handleBatchDelete = useCallback(async () => {
    if (selectedItems.size === 0) return
    try {
      const response = await apiPost('/api/storage/delete-batch', { paths: Array.from(selectedItems) })
      const data = await response.json()
      if (response.ok) {
        setSelectedItems(new Set())
        setDeleteModal(false)
        fetchStats()
        let message = `Deleted ${data.deleted_count} item(s)`
        if (data.skipped_locked_count > 0) message += `, skipped ${data.skipped_locked_count} locked`
        if (data.failed_count > 0) message += `, ${data.failed_count} failed`
        showToast('success', message)
      }
    } catch {
      showToast('error', 'Failed to delete items')
    }
  }, [selectedItems, fetchStats, showToast])

  const updateSettings = useCallback(async (newSettings) => {
    try {
      const response = await apiPost('/api/storage/settings', { storage_settings: newSettings })
      if (response.ok) {
        setSettings(newSettings)
        setEditedSettings(newSettings)
        showToast('success', 'Settings saved')
      }
    } catch {
      showToast('error', 'Failed to save settings')
    }
  }, [showToast])

  const handleSaveSettings = useCallback(() => {
    if (!editedSettings) return
    updateSettings({
      ...editedSettings,
      max_storage_gb: Math.max(1, parseInt(editedSettings.max_storage_gb) || 100),
      max_age_days: Math.max(1, parseInt(editedSettings.max_age_days) || 30)
    })
  }, [editedSettings, updateSettings])

  const hasUnsavedChanges = useCallback(() => {
    if (!settings || !editedSettings) return false
    return JSON.stringify(settings) !== JSON.stringify(editedSettings)
  }, [settings, editedSettings])

  const fetchReencodeTracks = useCallback(async () => {
    const paths = Array.from(selectedItems)
    if (paths.length === 0) return
    setLoadingTracks(true)
    try {
      const response = await apiFetch(`/api/video/tracks?path=${encodeURIComponent(paths[0])}`)
      const data = await response.json()
      if (response.ok && data.tracks) {
        setReencodeAudioTracks(data.tracks)
        setReencodeSelectedTracks(data.tracks.map((_, i) => i))
      } else {
        setReencodeAudioTracks([])
        setReencodeSelectedTracks([])
      }
    } catch {
      setReencodeAudioTracks([])
      setReencodeSelectedTracks([])
    } finally {
      setLoadingTracks(false)
    }
  }, [selectedItems])

  const toggleReencodeTrack = useCallback((index) => {
    setReencodeSelectedTracks(prev => {
      if (prev.includes(index)) {
        if (prev.length <= 1) return prev
        return prev.filter(i => i !== index)
      }
      return [...prev, index].sort((a, b) => a - b)
    })
  }, [])

  const items = useMemo(() => {
    if (!stats) return []
    let result = []
    if (filterType === 'all' || filterType === 'recordings')
      result = [...result, ...stats.recordings.map(r => ({ ...r, type: 'recording' }))]
    if (filterType === 'all' || filterType === 'clips')
      result = [...result, ...stats.clips.map(c => ({ ...c, type: 'clip' }))]
    if (filterGame !== 'all')
      result = result.filter(item => item.game_name === filterGame)
    result.sort((a, b) => {
      if (sortBy === 'date') return b.mtime - a.mtime
      if (sortBy === 'size') return b.size_bytes - a.size_bytes
      if (sortBy === 'game') {
        const gc = a.game_name.localeCompare(b.game_name)
        return gc !== 0 ? gc : b.mtime - a.mtime
      }
      return a.filename.localeCompare(b.filename)
    })
    return result
  }, [stats, filterType, filterGame, sortBy])

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B'
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const handleReencode = useCallback(async () => {
    if (selectedItems.size === 0) return
    setIsReencoding(true)
    const paths = Array.from(selectedItems)
    const totalFiles = paths.length
    let successCount = 0, failCount = 0, totalSavings = 0
    const audioTracksParam = reencodeAudioTracks.length > 1 && reencodeSelectedTracks.length < reencodeAudioTracks.length
      ? reencodeSelectedTracks : null
    setReencodeProgress({ current: 0, total: totalFiles, currentFile: '' })
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      const item = items.find(it => it.path === path)
      const filename = item?.filename || path.split(/[\\/]/).pop()
      setReencodeProgress({ current: i + 1, total: totalFiles, currentFile: filename })
      try {
        const response = await apiPost('/api/reencode', {
          source_path: path, codec: reencodeSettings.codec, crf: reencodeSettings.crf,
          preset: reencodeSettings.preset, replace_original: reencodeSettings.replaceOriginal,
          original_size: item?.size_bytes || 0, audio_tracks: audioTracksParam
        })
        const data = await response.json()
        if (response.ok) { successCount++; totalSavings += data.savings || 0 }
        else failCount++
      } catch { failCount++ }
    }
    setIsReencoding(false)
    setReencodeModal(false)
    setReencodeProgress({ current: 0, total: 0, currentFile: '' })
    setSelectedItems(new Set())
    fetchStats()
    const label = reencodeSettings.codec === 'copy' ? 'Re-exported' : 'Reencoded'
    const savingsFormatted = totalSavings > 0 ? ` (saved ${formatBytes(totalSavings)})` : ''
    showToast('success', `${label} ${successCount} file(s)${savingsFormatted}${failCount > 0 ? `, ${failCount} failed` : ''}`)
  }, [items, selectedItems, reencodeSettings, reencodeAudioTracks, reencodeSelectedTracks, fetchStats, showToast])

  const handleItemClick = useCallback((item) => {
    if (item.type === 'clip') navigate(`/clips?path=${encodeURIComponent(item.path)}`)
    else navigate(`/recordings?path=${encodeURIComponent(item.path)}`)
  }, [navigate])

  // Zoom toward the viewport centre (used by ± buttons)
  const zoomBy = useCallback((factor) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const anchorX = rect.width / 2
    const anchorY = rect.height / 2
    const curZoom = zoomRef.current
    const curPan = panRef.current
    const newZoom = Math.max(0.5, Math.min(5, curZoom * factor))
    const cx = (anchorX - curPan.x) / curZoom
    const cy = (anchorY - curPan.y) / curZoom
    const newPanX = anchorX - cx * newZoom
    const newPanY = anchorY - cy * newZoom
    zoomRef.current = newZoom
    panRef.current = { x: newPanX, y: newPanY }
    setZoom(newZoom)
    flushRedraw()
  }, []) // flushRedraw reads from rafRef/drawCanvasRef which are always current

  const gameColors = useMemo(() => {
    if (!stats) return {}
    const games = new Set()
    stats.recordings?.forEach(r => games.add(r.game_name))
    stats.clips?.forEach(c => games.add(c.game_name))
    const map = {}
    Array.from(games).sort().forEach((g, i) => { map[g] = GAME_PALETTE[i % GAME_PALETTE.length] })
    return map
  }, [stats])

  const byGameBytes = useMemo(() => {
    if (!stats) return {}
    const map = {}
    ;[...(stats.recordings || []), ...(stats.clips || [])].forEach(item => {
      map[item.game_name] = (map[item.game_name] || 0) + item.size_bytes
    })
    return map
  }, [stats])

  const totalBytes = useMemo(() => Object.values(byGameBytes).reduce((s, v) => s + v, 0), [byGameBytes])

  // Layout is computed at base (zoom=1) dimensions; zoom is applied via coordinate scaling in render.
  // This keeps squarify out of the zoom hot-path — only re-runs when items or container size change.
  const treemapLayout = useMemo(
    () => squarifiedTreemap(items, baseSize.w, baseSize.h),
    [items, baseSize.w, baseSize.h]
  )

  // Keep viewport refs in sync so wheel/zoom handlers always read fresh values
  zoomRef.current = zoom

  // ── Canvas drawing (imperative, does not touch React DOM) ────────────────────
  // drawCanvasRef.current is updated every render so hot-path handlers always call the latest closure
  drawCanvasRef.current = () => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.width || !canvas.height) return
    const ctx = canvas.getContext('2d')
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
      // Frustum cull — skip blocks fully outside the viewport
      if (x + w < 0 || x > cssW || y + h < 0 || y > cssH) continue

      const color = colors[item.game_name] || '#888'
      const isSelected = selected.has(item.path)
      const isLocked = locked.has(normPath(item.path))
      const minDim = Math.min(w, h)

      // Background
      ctx.fillStyle = isSelected ? hexToRgba(color, 0.14) : '#1e1e1e'
      drawRoundRect(ctx, x, y, w, h, Math.min(4, minDim / 4))
      ctx.fill()

      // Border
      ctx.strokeStyle = isSelected ? color : isLocked ? '#f59e0b' : '#3a3a3a'
      ctx.lineWidth = isSelected ? 2 : 1
      ctx.stroke()

      // Color bar at top
      const barH = Math.min(4, h)
      ctx.fillStyle = color
      ctx.fillRect(x, y, w, barH)

      // Text labels (only when large enough)
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      if (minDim >= 52) {
        ctx.fillStyle = color
        ctx.font = 'bold 10px system-ui, sans-serif'
        ctx.fillText(item.game_name, x + 5, y + 17, w - 28)
      }
      if (minDim >= 80) {
        ctx.fillStyle = '#999'
        ctx.font = '9px system-ui, sans-serif'
        ctx.fillText(item.filename, x + 5, y + 29, w - 10)
        ctx.fillText(item.size_formatted, x + 5, y + 41, w - 10)
      }

      // Lock indicator — drawn as a small padlock shape (top-right corner)
      if (isLocked && minDim >= 36) {
        const lx = x + w - 12, ly = y + 5, lw = 7, lh = 6, lr = 1.5
        ctx.fillStyle = '#f59e0b'
        // shackle (arc)
        ctx.beginPath()
        ctx.arc(lx + lw / 2, ly + 1, lw / 2 - 0.5, Math.PI, 0)
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#f59e0b'
        ctx.stroke()
        // body (rectangle)
        ctx.fillRect(lx, ly + lr, lw, lh)
      }

      // Selection checkmark badge — top-left corner
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

  // Schedule a canvas redraw via requestAnimationFrame (coalesces rapid calls)
  const requestRedraw = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      drawCanvasRef.current()
    })
  }, [])

  // Immediately cancel any pending RAF frame and schedule a new one (used by hot-path handlers)
  const flushRedraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; drawCanvasRef.current() })
  }, [])

  // Sync render-relevant state into refs and request a canvas redraw
  useEffect(() => { layoutRef.current = treemapLayout; requestRedraw() }, [treemapLayout, requestRedraw])
  useEffect(() => { selectedItemsRef.current = selectedItems; requestRedraw() }, [selectedItems, requestRedraw])
  useEffect(() => { lockedRef.current = lockedRecordings; requestRedraw() }, [lockedRecordings, requestRedraw])
  useEffect(() => { gameColorsRef.current = gameColors; requestRedraw() }, [gameColors, requestRedraw])
  useEffect(() => { requestRedraw() }, [zoom, requestRedraw])

  // Hit-test: canvas (CSS) pixel → layout item
  const getItemAt = useCallback((canvasX, canvasY) => {
    const z = zoomRef.current
    const { x: px, y: py } = panRef.current
    const lx = (canvasX - px) / z
    const ly = (canvasY - py) / z
    return layoutRef.current.find(item =>
      lx >= item.rx && lx <= item.rx + item.rw &&
      ly >= item.ry && ly <= item.ry + item.rh
    ) ?? null
  }, [])

  // Is the click within the lock-button area (top-right corner of block)?
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
      toggleLock(e, item.path)
    } else {
      toggleSelection(item.path)
    }
  }, [getItemAt, isLockArea, toggleLock, toggleSelection])

  const handleCanvasDblClick = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const item = getItemAt(e.clientX - rect.left, e.clientY - rect.top)
    if (item) handleItemClick(item)
  }, [getItemAt, handleItemClick])

  const handleCanvasMouseMove = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const item = getItemAt(cx, cy)
    if (item) {
      const isLocked = lockedRef.current.has(normPath(item.path))
      setTooltip({
        x: e.clientX, y: e.clientY,
        text: `${item.game_name} · ${item.filename}\n${item.size_formatted} · ${item.date}${isLocked ? ' · [Locked]' : ''}`
      })
    } else {
      setTooltip(null)
    }
  }, [getItemAt])

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading"><div className="spinner" /></div>
      </div>
    )
  }

  const selectedCount = selectedItems.size

  return (
    <div className="storage-v2">
      {/* ── Top bar ── */}
      <div className="sv2-topbar">
        <div className="sv2-title-group">
          <HardDrive size={16} />
          <span className="sv2-title">Storage</span>
          <span className="sv2-pill">{stats?.total_size_formatted}</span>
          <span className="sv2-pill">{stats?.recording_count} rec</span>
          <span className="sv2-pill">{stats?.clip_count} clips</span>
        </div>

        {totalBytes > 0 && (
          <div className="sv2-usage-bar-wrap">
            <div className="sv2-usage-bar">
              {Object.entries(byGameBytes)
                .sort((a, b) => b[1] - a[1])
                .map(([game, bytes]) => (
                  <div
                    key={game}
                    className="sv2-usage-seg"
                    style={{ width: `${(bytes / totalBytes) * 100}%`, background: gameColors[game] || '#666' }}
                    title={`${game}: ${formatBytes(bytes)}`}
                  />
                ))}
            </div>
            {stats?.disk_usage && (
              <div className="sv2-disk-note">
                {stats.disk_usage.free_formatted} free of {stats.disk_usage.total_formatted}
              </div>
            )}
          </div>
        )}

        <div className="sv2-topbar-right">
          <div className="sv2-zoom-ctrl">
            <button onClick={() => zoomBy(0.8)} title="Zoom out"><ZoomOut size={13} /></button>
            <button className="sv2-zoom-pct" onClick={() => { setZoom(1); zoomRef.current = 1; panRef.current = { x: 0, y: 0 }; flushRedraw() }} title="Reset view">{Math.round(zoom * 100)}%</button>
            <button onClick={() => zoomBy(1.25)} title="Zoom in"><ZoomIn size={13} /></button>
          </div>
          {selectedCount > 0 && (
            <span className="sv2-sel-pill">{selectedCount} selected</span>
          )}
          <button className="sv2-options-btn" onClick={() => setSettingsOpen(true)}>
            <Filter size={13} /> Options
          </button>
        </div>
      </div>

      {/* ── Game legend ── */}
      {Object.keys(gameColors).length > 0 && (
        <div className="sv2-legend">
          <button
            className={`sv2-legend-all ${filterGame === 'all' ? 'active' : ''}`}
            onClick={() => setFilterGame('all')}
          >All</button>
          {Object.entries(gameColors).map(([game, color]) => (
            <button
              key={game}
              className={`sv2-legend-item ${filterGame === game ? 'active' : ''}`}
              onClick={() => setFilterGame(filterGame === game ? 'all' : game)}
            >
              <span className="sv2-legend-dot" style={{ background: color }} />
              {game}
            </button>
          ))}
        </div>
      )}

      {/* ── Treemap (canvas-rendered for performance) ── */}
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
              // Redraw directly via RAF — no React state update during drag
              flushRedraw()
            }
          }
          const onUp = () => {
            const wasDrag = dragRef.current?.moved
            dragRef.current = null
            setIsDragging(false)
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            // Swallow the synthetic click that fires after mouseup so blocks don't get selected
            if (wasDrag) window.addEventListener('click', e => e.stopPropagation(), { capture: true, once: true })
          }
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
          onMouseLeave={() => setTooltip(null)}
        />
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="sv2-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          {tooltip.text.split('\n').map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {/* ── Settings / Options Modal ── */}
      {settingsOpen && (
        <>
          <div className="sv2-modal-bd" onClick={() => setSettingsOpen(false)} />
          <div className="sv2-settings-modal">
            <div className="ssm-head">
              <span>Options</span>
              <button className="ssm-close" onClick={() => setSettingsOpen(false)}><X size={14} /></button>
            </div>

            <div className="ssm-sect">
              <div className="ssm-sect-label">Filter &amp; Sort</div>
              <div className="ssm-row">
                <label>Type</label>
                <select value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="all">All</option>
                  <option value="recordings">Recordings</option>
                  <option value="clips">Clips</option>
                </select>
              </div>
              <div className="ssm-row">
                <label>Sort by</label>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="date">Newest first</option>
                  <option value="size">Largest first</option>
                  <option value="name">Name</option>
                  <option value="game">Game</option>
                </select>
              </div>
            </div>

            {selectedCount > 0 && (
              <div className="ssm-sect">
                <div className="ssm-sect-label">{selectedCount} Selected</div>
                <div className="ssm-action-row">
                  <button className="btn btn-secondary btn-sm" onClick={() => setSelectedItems(new Set())}>Clear</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { setReencodeModal(true); fetchReencodeTracks(); setSettingsOpen(false) }}>
                    <Film size={12} /> Reencode
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => { setDeleteModal(true); setSettingsOpen(false) }}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            )}

            {editedSettings && (
              <div className="ssm-sect">
                <div className="ssm-sect-label">Auto-Delete</div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editedSettings.auto_delete_enabled || false}
                    onChange={e => setEditedSettings({ ...editedSettings, auto_delete_enabled: e.target.checked })}
                  />
                  Enable automatic deletion
                </label>
                <div className="ssm-row">
                  <label>Max storage (GB)</label>
                  <input
                    type="text"
                    value={editedSettings.max_storage_gb ?? ''}
                    onChange={e => setEditedSettings({ ...editedSettings, max_storage_gb: e.target.value.replace(/[^0-9]/g, '') })}
                    disabled={!editedSettings.auto_delete_enabled}
                    placeholder="100"
                  />
                </div>
                <div className="ssm-row">
                  <label>Max age (days)</label>
                  <input
                    type="text"
                    value={editedSettings.max_age_days ?? ''}
                    onChange={e => setEditedSettings({ ...editedSettings, max_age_days: e.target.value.replace(/[^0-9]/g, '') })}
                    disabled={!editedSettings.auto_delete_enabled}
                    placeholder="30"
                  />
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editedSettings.exclude_clips !== false}
                    onChange={e => setEditedSettings({ ...editedSettings, exclude_clips: e.target.checked })}
                    disabled={!editedSettings.auto_delete_enabled}
                  />
                  Exclude clips from auto-delete
                </label>
                <p className="ssm-note"><Info size={11} /> Runs on watcher start. Locked files are never deleted.</p>
                {hasUnsavedChanges() && (
                  <button className="btn btn-primary btn-sm" onClick={handleSaveSettings} style={{ marginTop: 10 }}>
                    <Save size={12} /> Save Settings
                  </button>
                )}
              </div>
            )}

            {stats?.disk_usage && (
              <div className="ssm-sect ssm-disk">
                <div className="ssm-sect-label">Disk</div>
                <div className="ssm-disk-row">
                  <HardDrive size={12} />
                  <span>{stats.disk_usage.used_formatted} used / {stats.disk_usage.total_formatted} total</span>
                </div>
                <div className="ssm-disk-row">
                  <span className="ssm-free">{stats.disk_usage.free_formatted} free</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Reencode Modal ── */}
      {reencodeModal && (
        <div className="modal-overlay" onClick={() => !isReencoding && setReencodeModal(false)}>
          <div className="modal-content reencode-modal" onClick={e => e.stopPropagation()}>
            <h2>Reencode Videos</h2>
            <p>Reencode {selectedCount} selected video(s) to a different codec</p>
            <div className="reencode-settings">
              <div className="setting-row">
                <label>Codec:</label>
                <select value={reencodeSettings.codec} onChange={e => setReencodeSettings({ ...reencodeSettings, codec: e.target.value })} disabled={isReencoding}>
                  <option value="h264">H.264 (widely compatible)</option>
                  <option value="h265">H.265/HEVC (better compression)</option>
                  <option value="av1">AV1 (best compression, slower)</option>
                  <option value="copy">Stream Copy (track removal only, instant)</option>
                </select>
              </div>
              {reencodeSettings.codec !== 'copy' && (
                <>
                  <div className="setting-row">
                    <label>Quality (CRF):</label>
                    <input type="range" min="18" max="28" value={reencodeSettings.crf} onChange={e => setReencodeSettings({ ...reencodeSettings, crf: parseInt(e.target.value) })} disabled={isReencoding} />
                    <span>{reencodeSettings.crf} {reencodeSettings.crf < 20 ? '(high)' : reencodeSettings.crf < 24 ? '(medium)' : '(low)'}</span>
                  </div>
                  <div className="setting-row">
                    <label>Speed Preset:</label>
                    <select value={reencodeSettings.preset} onChange={e => setReencodeSettings({ ...reencodeSettings, preset: e.target.value })} disabled={isReencoding}>
                      <option value="veryfast">Very Fast (larger file)</option>
                      <option value="fast">Fast</option>
                      <option value="medium">Medium (recommended)</option>
                      <option value="slow">Slow (smaller file)</option>
                      <option value="veryslow">Very Slow (smallest file)</option>
                    </select>
                  </div>
                </>
              )}
              {reencodeAudioTracks.length > 1 && (
                <div className="clip-tracks">
                  <label className="clip-tracks-label">Audio Tracks</label>
                  {loadingTracks
                    ? <div className="track-loading">Loading tracks...</div>
                    : (
                      <div className="track-list">
                        {reencodeAudioTracks.map((track, i) => (
                          <label key={i} className="track-item">
                            <input type="checkbox" checked={reencodeSelectedTracks.includes(i)} onChange={() => toggleReencodeTrack(i)} disabled={isReencoding} />
                            <span className="track-name">{track.title || `Track ${i + 1}`}</span>
                            <span className="track-detail">{track.codec_name} · {track.channels}ch</span>
                          </label>
                        ))}
                      </div>
                    )
                  }
                </div>
              )}
              <label className="checkbox-label">
                <input type="checkbox" checked={reencodeSettings.replaceOriginal} onChange={e => setReencodeSettings({ ...reencodeSettings, replaceOriginal: e.target.checked })} disabled={isReencoding} />
                Replace original files (saves space)
              </label>
              <p className="modal-note">
                {reencodeSettings.codec === 'copy'
                  ? 'Stream copy re-exports the video without re-encoding. Use this to quickly remove unwanted audio tracks.'
                  : 'Reencoding may take several minutes per video. Lower CRF = better quality but larger files. H.265 typically saves 30-50% space compared to H.264.'}
              </p>
            </div>
            {isReencoding && (
              <div className="reencode-progress">
                <div className="progress-info">
                  <span>Reencoding {reencodeProgress.current} of {reencodeProgress.total}</span>
                  <span className="progress-filename">{reencodeProgress.currentFile}</span>
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width: `${(reencodeProgress.current / reencodeProgress.total) * 100}%` }} />
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setReencodeModal(false)} disabled={isReencoding}>Cancel</button>
              <button className="btn btn-primary" onClick={handleReencode} disabled={isReencoding}>
                {isReencoding ? <><Loader size={14} /> Processing...</> : reencodeSettings.codec === 'copy' ? <><Package size={14} /> Re-export</> : <><Film size={14} /> Start Reencoding</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={deleteModal}
        title="Delete Selected Items?"
        message={`Delete ${selectedCount} item(s)? This cannot be undone.`}
        onConfirm={handleBatchDelete}
        onCancel={() => setDeleteModal(false)}
        confirmText="Delete"
        cancelText="Cancel"
        danger
      />

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={14} /> : <X size={14} />} {toast.message}
        </div>
      )}
    </div>
  )
}

export default StoragePage
