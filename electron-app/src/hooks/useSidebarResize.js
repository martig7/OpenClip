import { useState, useRef, useCallback, useEffect } from 'react'

/** Same min/max as Recordings MediaSidebar */
export const SIDEBAR_WIDTH_MIN = 280
export const SIDEBAR_WIDTH_MAX = 800
export const SIDEBAR_WIDTH_DEFAULT = 320

/** Recordings / Clips list sidebar */
export const STORAGE_KEY_MEDIA_SIDEBAR = 'sidebarWidth'
/** Settings nav sidebar (separate width preference) */
export const STORAGE_KEY_SETTINGS_SIDEBAR = 'settingsSidebarWidth'
/** Games page detail drawer */
export const STORAGE_KEY_GAMES_DRAWER = 'gamesDrawerWidth'
/** Games caption cluster width */
export const STORAGE_KEY_GAMES_CAPTION_CLUSTER = 'gamesCaptionClusterWidth'

function clampWidth(w, min, max) {
  return Math.min(max, Math.max(min, w))
}

function readStoredWidth(storageKey, min, max, defaultW) {
  const saved = localStorage.getItem(storageKey)
  if (!saved) return clampWidth(defaultW, min, max)
  const n = parseInt(saved, 10)
  if (Number.isNaN(n)) return clampWidth(defaultW, min, max)
  return clampWidth(n, min, max)
}

/**
 * Resizable sidebar width (mouse drag on `.sidebar-resizer`).
 * Persists to localStorage on mouseup.
 *
 * @param {string} storageKey  localStorage key for persisting width
 * @param {object} [opts]
 * @param {number} [opts.min]       minimum width (default SIDEBAR_WIDTH_MIN)
 * @param {number} [opts.max]       maximum width (default SIDEBAR_WIDTH_MAX)
 * @param {number} [opts.defaultW]  initial width (default SIDEBAR_WIDTH_DEFAULT)
 * @param {'left'|'right'} [opts.side]  which edge the panel is on (default 'left')
 */
export function useSidebarResize(storageKey, opts = {}) {
  const min = opts.min ?? SIDEBAR_WIDTH_MIN
  const max = opts.max ?? SIDEBAR_WIDTH_MAX
  const defaultW = opts.defaultW ?? SIDEBAR_WIDTH_DEFAULT
  const sign = opts.side === 'right' ? -1 : 1

  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredWidth(storageKey, min, max, defaultW)
  )
  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const prevWidthRef = useRef(sidebarWidth)
  const widthRef = useRef(sidebarWidth)
  widthRef.current = sidebarWidth

  const handleMouseMove = useCallback((e) => {
    if (!isDraggingRef.current) return
    const delta = e.clientX - startXRef.current
    const newWidth = clampWidth(prevWidthRef.current + delta * sign, min, max)
    widthRef.current = newWidth
    setSidebarWidth(newWidth)
  }, [min, max, sign])

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    document.body.style.cursor = ''
    localStorage.setItem(storageKey, String(widthRef.current))
  }, [storageKey])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // Keep width inside [min, max] when bounds or key change (e.g. caption min/max updated, HMR).
  useEffect(() => {
    setSidebarWidth((w) => clampWidth(w, min, max))
  }, [min, max, storageKey])

  const handleMouseDown = useCallback(
    (e) => {
      e.preventDefault()
      isDraggingRef.current = true
      startXRef.current = e.clientX
      prevWidthRef.current = sidebarWidth
      document.body.style.cursor = 'col-resize'
    },
    [sidebarWidth]
  )

  return { sidebarWidth, handleMouseDown }
}
