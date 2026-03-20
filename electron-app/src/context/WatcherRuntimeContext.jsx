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

/**
 * Owns game-watcher IPC subscription, script-warning state, and setup-guide modal
 * so the sidebar panel and (formerly) Games page stay in sync without duplicating effects.
 */
export function WatcherRuntimeProvider({ children }) {
  const [watcherStatus, setWatcherStatus] = useState({
    running: false,
    currentGame: null,
    startedAt: null,
    gameState: null,
  })
  const [scriptWarning, setScriptWarning] = useState(false)
  const [setupGuideOpen, setSetupGuideOpen] = useState(false)
  const [actionError, setActionError] = useState(null)

  useEffect(() => {
    api
      .getWatcherStatus()
      .then((s) => {
        setWatcherStatus(s)
        if (s.running) {
          api
            .isOBSScriptLoaded()
            .then((loaded) => {
              if (!loaded) setScriptWarning(true)
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
    const unsub = api.onWatcherStatusPush((status) => setWatcherStatus(status))
    return () => unsub()
  }, [])

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
        setScriptWarning(false)
      } else {
        await api.startWatcher()
        api.isOBSScriptLoaded().then((loaded) => {
          if (!loaded) setScriptWarning(true)
        })
      }
    } catch (e) {
      setActionError(e?.message || 'Failed to toggle watcher')
    }
    await refreshWatcherStatus()
  }, [watcherStatus.running, refreshWatcherStatus])

  const openOBS = useCallback(() => {
    setActionError(null)
    api.launchOBS()
  }, [])

  const dismissScriptWarning = useCallback(() => setScriptWarning(false), [])
  const openSetupGuide = useCallback(() => setSetupGuideOpen(true), [])

  const value = {
    watcherStatus,
    scriptWarning,
    actionError,
    setActionError,
    toggleWatcher,
    refreshWatcherStatus,
    openOBS,
    dismissScriptWarning,
    openSetupGuide,
  }

  return (
    <WatcherRuntimeContext.Provider value={value}>
      {children}
      <OnboardingModal open={setupGuideOpen} onClose={() => setSetupGuideOpen(false)} />
    </WatcherRuntimeContext.Provider>
  )
}
