import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import api from './api'
import GamesPage from './pages/GamesPage'
import SettingsPage from './pages/SettingsPage'
import ViewerRecordingsPage from './viewer/pages/RecordingsPage'
import ViewerClipsPage from './viewer/pages/ClipsPage'
import ViewerStoragePage from './viewer/pages/StoragePage'
import OnboardingModal from './components/OnboardingModal'
import AppSidebarNav from './components/AppSidebarNav'
import { WatcherRuntimeProvider } from './context/WatcherRuntimeContext'
import { SettingsNavGuardProvider, useSettingsNavGuard } from './context/SettingsNavGuardContext'
import { TitleBarOverlayProvider, useTitleBarOverlayOverride } from './context/TitleBarOverlayContext'
import { getTitleBarOverlayForPath } from './utils/titleBarOverlayDefaults'
import './App.css'
import './viewer/viewer.css'

export const OrganizeErrorContext = createContext({
  organizeError: null,
  clearOrganizeError: () => {},
})
export function useOrganizeError() {
  return useContext(OrganizeErrorContext)
}

// Shared organize-progress state so VideoPlayer (deep) can signal App (root).
// isManualOrganizing + organizeProgress: set by VideoPlayer, read by AppLayout for the popup.
export const OrganizeProgressContext = createContext({
  isManualOrganizing: false,
  setIsManualOrganizing: () => {},
  organizeProgress: null, // { stage, label } | null
  setOrganizeProgress: () => {},
})
export function useOrganizeProgress() {
  return useContext(OrganizeProgressContext)
}

// Unified progress width: covers the full recording→clipping pipeline.
// Manual organize reuses the recording-phase scale (it runs the same stages).
function getProgressWidth(p, isManual = false) {
  if (!p) return 0
  const phase = isManual ? 'recording' : p.phase
  const stage = p.stage
  if (phase === 'recording') {
    if (stage === 'moving') return 45
    if (stage === 'remuxing') return 32
    if (stage === 'waiting') return 0
    return 10
  }
  if (phase === 'clipping') {
    return 50 + (((p.clipIndex ?? 0) + 1) / (p.clipTotal ?? 1)) * 45
  }
  return 100
}

// ── Inner layout component — needs useLocation() so it lives inside HashRouter ──

function AppLayout({ sessionProgress, updateState, showOnboarding, setShowOnboarding }) {
  const location = useLocation()
  const { guard } = useSettingsNavGuard()
  const { overlayOverride } = useTitleBarOverlayOverride()
  const { organizeError, clearOrganizeError } = useOrganizeError()
  const { isManualOrganizing, organizeProgress } = useOrganizeProgress()

  // Native caption buttons: match route-specific top strip (e.g. Storage toolbar) and page overrides (e.g. Settings warning banner)
  useLayoutEffect(() => {
    if (!api.setTitleBarOverlay) return
    const base = getTitleBarOverlayForPath(location.pathname)
    const merged = overlayOverride ? { ...base, ...overlayOverride } : base
    api.setTitleBarOverlay({
      color: merged.color,
      symbolColor: merged.symbolColor,
      height: 36,
    })
  }, [location.pathname, overlayOverride])

  function handleSidebarNavClick(e, path) {
    if (location.pathname !== '/settings' || path === '/settings') return
    const hasUnsaved = guard?.hasUnsaved?.() === true
    if (!hasUnsaved) return
    e.preventDefault()
    guard.handleNavigateAway?.(path)
  }

  const sidebarNavProps = {
    organizeError,
    clearOrganizeError,
    updateState,
    onNavClick: handleSidebarNavClick,
  }

  // Show session progress on all pages; fall back to manual organize progress.
  const isManual = !sessionProgress && isManualOrganizing
  const activeProgress = sessionProgress ?? (isManualOrganizing ? organizeProgress : null)

  const bannerWidth = getProgressWidth(activeProgress, isManual)
  const bannerLabel = isManual
    ? (activeProgress?.label ?? 'Organizing…')
    : sessionProgress?.phase === 'recording'
      ? `Processing session: ${sessionProgress.label}`
      : (sessionProgress?.label ?? 'Processing…')

  return (
    <>
      <OnboardingModal open={showOnboarding} onClose={() => setShowOnboarding(false)} />
      <div className="app-layout">
        <div className="titlebar-drag" />
        <AppSidebarNav {...sidebarNavProps} />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<GamesPage />} />
            <Route path="/recordings" element={<ViewerRecordingsPage />} />
            <Route path="/clips" element={<ViewerClipsPage />} />
            <Route path="/storage" element={<ViewerStoragePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>

      {activeProgress && (
        <div className="session-progress-banner">
          <div className="session-progress-label">
            <div
              className="spinner-sm"
              style={{ borderColor: 'rgba(245,158,11,0.25)', borderTopColor: 'var(--amber)' }}
            />
            {bannerLabel}
          </div>
          <div className="progress-bar-container session-progress-bar">
            <div
              className="progress-bar-fill session-progress-fill"
              style={{ width: `${bannerWidth}%` }}
            />
          </div>
        </div>
      )}
    </>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

export default function App() {
  const [updateState, setUpdateState] = useState(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [organizeError, setOrganizeError] = useState(null)

  // Auto-organize progress (from gameWatcher via session:process-progress)
  const [sessionProgress, setSessionProgress] = useState(null)

  // Manual organize progress (from VideoPlayer via recordings:organize-progress)
  const [isManualOrganizing, setIsManualOrganizing] = useState(false)
  const [organizeProgress, setOrganizeProgress] = useState(null)

  // First-run onboarding
  useEffect(() => {
    Promise.resolve(api.isOnboardingComplete?.())
      .then((done) => {
        if (!done) setShowOnboarding(true)
      })
      .catch(() => {})
  }, [])

  // Auto-updater events
  useEffect(() => {
    const offAvailable = api.onUpdateAvailable(({ version }) =>
      setUpdateState({ status: 'available', version })
    )
    const offProgress = api.onUpdateProgress(({ percent }) =>
      setUpdateState((s) => ({ ...s, status: 'downloading', percent }))
    )
    const offDownloaded = api.onUpdateDownloaded(() =>
      setUpdateState((s) => ({ ...s, status: 'ready' }))
    )
    const offError = api.onUpdateError((info) => {
      console.error('[updater] download error:', info?.message)
      setUpdateState(null)
    })
    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offError()
    }
  }, [])

  // Session (auto-organize) progress — drives both the popup and the error banner
  useEffect(() => {
    const unsub = api.onSessionProgress?.((p) => {
      if (p.phase === 'error') {
        setOrganizeError(p.error || 'An error occurred while organizing recordings.')
        setSessionProgress(null)
      } else if (p.phase === 'complete') {
        setSessionProgress(null)
      } else {
        // 'recording' | 'clipping'
        setSessionProgress(p)
      }
    })
    return () => unsub?.()
  }, [])

  // Clip marker sound
  useEffect(() => {
    let audioCtx = null

    const unsubscribe = api.onMarkerAdded(() => {
      try {
        if (!audioCtx || audioCtx.state === 'closed') {
          audioCtx = new AudioContext()
        }
        if (audioCtx.state === 'suspended') {
          audioCtx.resume()
        }
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.frequency.value = 880
        osc.type = 'sine'
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15)
        osc.start(audioCtx.currentTime)
        osc.stop(audioCtx.currentTime + 0.15)
      } catch (e) {
        console.error('Failed to play beep:', e)
      }
    })

    return () => {
      unsubscribe()
      if (audioCtx) audioCtx.close()
    }
  }, [])

  const clearOrganizeError = useCallback(() => {
    setOrganizeError(null)
    api.clearSessionProgress?.()
  }, [])

  return (
    <OrganizeErrorContext.Provider value={{ organizeError, clearOrganizeError }}>
      <OrganizeProgressContext.Provider
        value={{ isManualOrganizing, setIsManualOrganizing, organizeProgress, setOrganizeProgress }}
      >
        <HashRouter>
          <WatcherRuntimeProvider>
            <TitleBarOverlayProvider>
              <SettingsNavGuardProvider>
                <AppLayout
                  sessionProgress={sessionProgress}
                  updateState={updateState}
                  showOnboarding={showOnboarding}
                  setShowOnboarding={setShowOnboarding}
                />
              </SettingsNavGuardProvider>
            </TitleBarOverlayProvider>
          </WatcherRuntimeProvider>
        </HashRouter>
      </OrganizeProgressContext.Provider>
    </OrganizeErrorContext.Provider>
  )
}
