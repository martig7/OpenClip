import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import {
  AlertTriangle,
  Gamepad2,
  Video,
  Film,
  HardDrive,
  Settings,
  Sliders,
  Download,
  X,
} from 'lucide-react'
import appIcon from '../assets/icon.png'
import api from './api'
import GamesPage from './pages/GamesPage'
import SettingsPage from './pages/SettingsPage'
import EncodingPage from './pages/EncodingPage'
import ViewerRecordingsPage from './viewer/pages/RecordingsPage'
import ViewerClipsPage from './viewer/pages/ClipsPage'
import ViewerStoragePage from './viewer/pages/StoragePage'
import OnboardingModal from './components/OnboardingModal'
import './App.css'
import './viewer/viewer.css'

const navItems = [
  { path: '/', icon: Gamepad2, label: 'Games' },
  { path: '/recordings', icon: Video, label: 'Recordings' },
  { path: '/clips', icon: Film, label: 'Clips' },
  { path: '/storage', icon: HardDrive, label: 'Storage' },
  { path: '/encoding', icon: Sliders, label: 'Encoding' },
  { path: '/settings', icon: Settings, label: 'Settings' },
]

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
  const { organizeError, clearOrganizeError } = useOrganizeError()
  const { isManualOrganizing, organizeProgress } = useOrganizeProgress()

  // Show session progress on all pages; fall back to manual organize progress.
  const isManual = !sessionProgress && isManualOrganizing
  const activeProgress = sessionProgress ?? (isManualOrganizing ? organizeProgress : null)

  const bannerWidth = getProgressWidth(activeProgress, isManual)
  const bannerLabel = isManual
    ? (activeProgress?.label ?? 'Organizing…')
    : sessionProgress?.phase === 'recording'
      ? `Processing session — ${sessionProgress.label}`
      : (sessionProgress?.label ?? 'Processing…')

  return (
    <>
      <OnboardingModal open={showOnboarding} onClose={() => setShowOnboarding(false)} />
      <div className="app-layout">
        <div className="titlebar-drag" />
        <nav className="sidebar-nav">
          <div className="nav-brand">
            <img src={appIcon} alt="OpenClip logo" className="nav-brand-logo" />
            <span>OpenClip</span>
          </div>
          {navItems.map(({ path, icon: Icon, label }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === 'Recordings' && organizeError && (
                <span className="nav-error-badge" title={organizeError}>
                  <AlertTriangle size={12} />
                </span>
              )}
            </NavLink>
          ))}
          {updateState && (
            <div className="update-banner">
              <Download size={14} />
              {updateState.status === 'available' && <span>v{updateState.version} available</span>}
              {updateState.status === 'downloading' && (
                <span>Downloading… {updateState.percent}%</span>
              )}
              {updateState.status === 'ready' && (
                <>
                  <span>Update ready</span>
                  <button className="btn btn-primary btn-sm" onClick={() => api.installUpdate()}>
                    Restart
                  </button>
                </>
              )}
            </div>
          )}
          {organizeError && (
            <div className="organize-error-banner">
              <AlertTriangle size={13} />
              <span>Organize failed — see Recordings</span>
              <button className="organize-error-close" onClick={clearOrganizeError} title="Dismiss">
                <X size={12} />
              </button>
            </div>
          )}
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<GamesPage />} />
            <Route path="/recordings" element={<ViewerRecordingsPage />} />
            <Route path="/clips" element={<ViewerClipsPage />} />
            <Route path="/storage" element={<ViewerStoragePage />} />
            <Route path="/encoding" element={<EncodingPage />} />
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
      } catch {}
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
          <AppLayout
            sessionProgress={sessionProgress}
            updateState={updateState}
            showOnboarding={showOnboarding}
            setShowOnboarding={setShowOnboarding}
          />
        </HashRouter>
      </OrganizeProgressContext.Provider>
    </OrganizeErrorContext.Provider>
  )
}
