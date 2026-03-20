import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import api from '../api'
import OnboardingModal from '../components/OnboardingModal'

const WatcherRuntimeContext = createContext(null)

export function useWatcherRuntime() {
  const ctx = useContext(WatcherRuntimeContext)
  if (!ctx) {
    throw new Error('useWatcherRuntime must be used within WatcherRuntimeProvider')
  }
  return ctx
}

/** @typedef {null | 'obs_closed' | 'plugin_missing'} WatcherBannerKind */

/**
 * Owns game-watcher IPC subscription, OBS/plugin banner state, and setup-guide modal
 * so the sidebar panel stays in sync without duplicating effects.
 */
export function WatcherRuntimeProvider({ children }) {
  const [watcherStatus, setWatcherStatus] = useState({
    running: false,
    currentGame: null,
    startedAt: null,
    gameState: null,
  })
  /** When the watcher is running: OBS not open vs plugin not reachable (OBS is open). */
  const [watcherBannerKind, setWatcherBannerKind] = useState(/** @type {WatcherBannerKind} */ (null))
  const [setupGuideOpen, setSetupGuideOpen] = useState(false)
  const [actionError, setActionError] = useState(null)

  const evaluateWatcherBanner = useCallback(async () => {
    try {
      const s = await api.getWatcherStatus()
      if (!s.running) {
        setWatcherBannerKind(null)
        return
      }
      const obsRunning = await api.isOBSRunning()
      if (!obsRunning) {
        setWatcherBannerKind('obs_closed')
        return
      }
      const loaded = await api.isOBSScriptLoaded()
      setWatcherBannerKind(loaded ? null : 'plugin_missing')
    } catch {
      setWatcherBannerKind(null)
    }
  }, [])

  useEffect(() => {
    api
      .getWatcherStatus()
      .then((s) => {
        setWatcherStatus(s)
        if (s.running) evaluateWatcherBanner()
      })
      .catch(() => {})
    const unsub = api.onWatcherStatusPush((status) => {
      setWatcherStatus(status)
      if (!status.running) setWatcherBannerKind(null)
      else evaluateWatcherBanner()
    })
    return () => unsub()
  }, [evaluateWatcherBanner])

  // While the watcher is on, re-check OBS / plugin so the banner clears when OBS is launched.
  useEffect(() => {
    if (!watcherStatus.running) return undefined
    const id = setInterval(() => {
      evaluateWatcherBanner()
    }, 2500)
    return () => clearInterval(id)
  }, [watcherStatus.running, evaluateWatcherBanner])

  const refreshWatcherStatus = useCallback(async () => {
    try {
      setActionError(null)
      setWatcherStatus(await api.getWatcherStatus())
    } catch (e) {
      setActionError(e?.message || 'Failed to load watcher status')
    }
  }, [])

  const toggleWatcher = useCallback(async () => {
    setActionError(null)
    try {
      if (watcherStatus.running) {
        await api.stopWatcher()
        setWatcherBannerKind(null)
      } else {
        await api.startWatcher()
      }
    } catch (e) {
      setActionError(e?.message || 'Failed to toggle watcher')
    }
    await refreshWatcherStatus()
    await evaluateWatcherBanner()
  }, [watcherStatus.running, refreshWatcherStatus, evaluateWatcherBanner])

  const openOBS = useCallback(() => {
    setActionError(null)
    api.launchOBS()
  }, [])

  const dismissWatcherBanner = useCallback(() => setWatcherBannerKind(null), [])
  const openSetupGuide = useCallback(() => setSetupGuideOpen(true), [])

  const value = {
    watcherStatus,
    watcherBannerKind,
    actionError,
    setActionError,
    toggleWatcher,
    refreshWatcherStatus,
    openOBS,
    dismissWatcherBanner,
    openSetupGuide,
  }

  return (
    <WatcherRuntimeContext.Provider value={value}>
      {children}
      <OnboardingModal open={setupGuideOpen} onClose={() => setSetupGuideOpen(false)} />
    </WatcherRuntimeContext.Provider>
  )
}
