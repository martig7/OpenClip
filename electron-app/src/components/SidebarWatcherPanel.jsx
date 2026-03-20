import { useEffect, useState } from 'react'
import {
  ExternalLink,
  Square,
  Play,
  Circle,
  AlertTriangle,
  X,
  Settings,
} from 'lucide-react'
import { useWatcherRuntime } from '../context/WatcherRuntimeContext'
import { formatWatcherUptime, parseWatcherGameState } from '../pages/games/watcherStatusUtils'

export default function SidebarWatcherPanel() {
  const {
    watcherStatus,
    scriptWarning,
    actionError,
    setActionError,
    toggleWatcher,
    openOBS,
    dismissScriptWarning,
    openSetupGuide,
  } = useWatcherRuntime()

  const [, setTick] = useState(0)
  const state = parseWatcherGameState(watcherStatus.gameState)

  useEffect(() => {
    if (!watcherStatus.running) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [watcherStatus.running])

  return (
    <div className="sidebar-watcher-panel">
      <div className="sidebar-watcher-panel-title">Watcher</div>

      {actionError && (
        <div className="sidebar-watcher-error">
          <span>{actionError}</span>
          <button type="button" className="sidebar-watcher-error-dismiss" onClick={() => setActionError(null)} title="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}

      {scriptWarning && watcherStatus.running && (
        <div className="sidebar-watcher-warning">
          <AlertTriangle size={12} className="shrink-0" />
          <span className="sidebar-watcher-warning-text">
            OBS plugin not detected.
            <button type="button" className="sidebar-watcher-guide-link" onClick={openSetupGuide}>
              <Settings size={10} />
              Setup
            </button>
          </span>
          <button type="button" className="btn-icon" onClick={dismissScriptWarning} title="Dismiss">
            <X size={11} />
          </button>
        </div>
      )}

      <div className="sidebar-watcher-status-row">
        <Circle
          size={7}
          fill={watcherStatus.running ? 'var(--success)' : 'var(--text-muted)'}
          color={watcherStatus.running ? 'var(--success)' : 'var(--text-muted)'}
          className="shrink-0"
        />
        <span className={watcherStatus.running ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}>
          {watcherStatus.running ? 'Running' : 'Stopped'}
        </span>
        {watcherStatus.running && watcherStatus.startedAt && (
          <span className="sidebar-watcher-uptime">{formatWatcherUptime(watcherStatus.startedAt)}</span>
        )}
      </div>

      <div className="sidebar-watcher-state" style={{ color: state.color }}>
        {state.recording && (
          <Circle size={6} fill="var(--danger)" color="var(--danger)" className="inline shrink-0 mr-1" />
        )}
        {state.label}
      </div>

      <div className="sidebar-watcher-actions">
        <button type="button" className="btn btn-secondary btn-sm sidebar-watcher-btn" onClick={openOBS} title="Open OBS">
          <ExternalLink size={12} />
          <span>OBS</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm sidebar-watcher-btn ${watcherStatus.running ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => toggleWatcher()}
        >
          {watcherStatus.running ? (
            <>
              <Square size={12} />
              <span>Stop</span>
            </>
          ) : (
            <>
              <Play size={12} />
              <span>Start</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
