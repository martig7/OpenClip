/**
 * Native caption strip (Windows/Linux titleBarOverlay) should match the visible
 * background behind the minimize / maximize / close buttons (top-right of main pane).
 *
 * Hex values align with src/index.css :root and viewer.css (e.g. Storage sv2-topbar).
 */
export const TITLEBAR_OVERLAY_DEFAULTS = {
  _default: { color: '#0f0f0f', symbolColor: '#aaaaaa' },
  '/': { color: '#0f0f0f', symbolColor: '#aaaaaa' },
  '/recordings': { color: '#0f0f0f', symbolColor: '#aaaaaa' },
  '/clips': { color: '#0f0f0f', symbolColor: '#aaaaaa' },
  /** sv2-topbar uses --bg-secondary */
  '/storage': { color: '#181818', symbolColor: '#aaaaaa' },
  /** Matches recordings and clips topbar */
  '/settings': { color: '#0f0f0f', symbolColor: '#aaaaaa' },
}

/** Settings leave-warning banner, matches .settings-leave-warning-banner (--danger) */
export const TITLEBAR_SETTINGS_WARNING = {
  color: '#ef4444',
  symbolColor: '#ffffff',
}

export function getTitleBarOverlayForPath(pathname) {
  return TITLEBAR_OVERLAY_DEFAULTS[pathname] ?? TITLEBAR_OVERLAY_DEFAULTS._default
}
