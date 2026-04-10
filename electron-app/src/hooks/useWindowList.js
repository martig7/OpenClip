import { useState, useCallback } from 'react'
import api from '../api'

/**
 * Manages the window picker list: fetches visible windows from the OS,
 * tracks loading state, and provides a stable refresh function.
 *
 * Used by both AddGameModal (via useAddGameModalState) and SimpleAddGameModal.
 *
 * @returns {{ visibleWindows, setVisibleWindows, loadingWindows, refreshWindows }}
 */
export function useWindowList() {
  const [visibleWindows, setVisibleWindows] = useState([])
  const [loadingWindows, setLoadingWindows] = useState(false)

  // useCallback gives callers a stable reference so useEffect dependency arrays
  // that include refreshWindows don't cause infinite re-render loops.
  const refreshWindows = useCallback(async () => {
    setLoadingWindows(true)
    try {
      const windows = await api.getVisibleWindows()
      setVisibleWindows(windows || [])
    } catch {
      // silently fail; user can retry with the refresh button
    } finally {
      setLoadingWindows(false)
    }
  }, []) // no external deps; setters from useState are stable

  return { visibleWindows, setVisibleWindows, loadingWindows, refreshWindows }
}
