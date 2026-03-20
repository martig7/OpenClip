import { NavLink } from 'react-router-dom'
import { AlertTriangle, Download, Settings, X } from 'lucide-react'
import appIcon from '../../assets/icon.png'
import api from '../api'
import SidebarWatcherPanel from './SidebarWatcherPanel'
import { useWatcherRuntime } from '../context/WatcherRuntimeContext'
import './AppSidebarNav.css'

const navItems = [
  { path: '/', label: 'Games' },
  { path: '/recordings', label: 'Recordings' },
  { path: '/clips', label: 'Clips' },
  { path: '/storage', label: 'Storage' },
  { path: '/settings', label: 'Settings' },
]

function SidebarWatcherBanner() {
  const { watcherStatus, watcherBannerKind, dismissWatcherBanner, openSetupGuide } =
    useWatcherRuntime()

  if (!watcherStatus.running || !watcherBannerKind) return null

  if (watcherBannerKind === 'obs_closed') {
    return (
      <div className="sidebar-nav-watcher-banner" role="status">
        <span className="sidebar-nav-watcher-banner-text">
          OBS is closed. Start OBS to start recording.
        </span>
        <button
          type="button"
          className="sidebar-nav-watcher-banner-dismiss"
          onClick={dismissWatcherBanner}
          title="Dismiss"
        >
          <X size={11} />
        </button>
      </div>
    )
  }

  return (
    <div className="sidebar-nav-watcher-banner" role="status">
      <span className="sidebar-nav-watcher-banner-text">
        OBS plugin not detected.{' '}
        <button type="button" className="sidebar-watcher-guide-link" onClick={openSetupGuide}>
          <Settings size={10} />
          Setup
        </button>
      </span>
      <button
        type="button"
        className="sidebar-nav-watcher-banner-dismiss"
        onClick={dismissWatcherBanner}
        title="Dismiss"
      >
        <X size={11} />
      </button>
    </div>
  )
}

/**
 * Primary app sidebar: brand, route links, watcher panel, update / error footers.
 * Padding is split: `.app-sidebar-nav__padding` for insets vs `.app-sidebar-nav` shell.
 */
export default function AppSidebarNav({ organizeError, clearOrganizeError, updateState, onNavClick }) {
  return (
    <nav className="app-sidebar-nav" aria-label="Main">
      <div className="app-sidebar-nav__inner app-sidebar-nav__padding">
        <div className="nav-brand">
          <img src={appIcon} alt="OpenClip logo" className="nav-brand-logo" />
        </div>
        {navItems.map(({ path, label }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={(e) => onNavClick(e, path)}
          >
            {label}
            {label === 'Recordings' && organizeError && (
              <span className="nav-error-badge" title={organizeError}>
                <AlertTriangle size={12} />
              </span>
            )}
          </NavLink>
        ))}
        <div className="app-sidebar-nav__spacer" aria-hidden />
        <SidebarWatcherBanner />
        <SidebarWatcherPanel />
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
            <span>Organize failed: See Recordings for details</span>
            <button className="organize-error-close" onClick={clearOrganizeError} title="Dismiss">
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}
