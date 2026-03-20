import { useState, useRef, useCallback, useEffect } from 'react'

/** Same min/max as Recordings MediaSidebar */
export const SIDEBAR_WIDTH_MIN = 280
export const SIDEBAR_WIDTH_MAX = 800
export const SIDEBAR_WIDTH_DEFAULT = 320

/** Recordings / Clips list sidebar */
export const STORAGE_KEY_MEDIA_SIDEBAR = 'sidebarWidth'
/** Settings nav sidebar (separate width preference) */
export const STORAGE_KEY_SETTINGS_SIDEBAR = 'settingsSidebarWidth'

function readStoredWidth(storageKey) {
  const saved = localStorage.getItem(storageKey)
  if (!saved) return SIDEBAR_WIDTH_DEFAULT
  const n = parseInt(saved, 10)
  if (Number.isNaN(n)) return SIDEBAR_WIDTH_DEFAULT
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n))
}

/**
 * Resizable sidebar width (mouse drag on `.sidebar-resizer`).
 * Persists to localStorage on mouseup.
 */
export function useSidebarResize(storageKey) {
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredWidth(storageKey))
  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const prevWidthRef = useRef(sidebarWidth)
  const widthRef = useRef(sidebarWidth)
  widthRef.current = sidebarWidth

  const handleMouseMove = useCallback((e) => {
    if (!isDraggingRef.current) return
    const delta = e.clientX - startXRef.current
    const newWidth = Math.max(
      SIDEBAR_WIDTH_MIN,
      Math.min(SIDEBAR_WIDTH_MAX, prevWidthRef.current + delta)
    )
    widthRef.current = newWidth
    setSidebarWidth(newWidth)
  }, [])

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
