import { useEffect, useState } from 'react'
import { RefreshCw, Check } from 'lucide-react'
import api from '../../api'
import { useWindowList } from '../../hooks/useWindowList'

export default function SimpleAddGameModal({
  newGame,
  setNewGame,
  setAutoCreateScene,
  onClose,
  onAddGame,
  onSwitchToAdvanced,
}) {
  const [selected, setSelected] = useState(null)
  const { visibleWindows, loadingWindows, refreshWindows } = useWindowList()

  useEffect(() => {
    refreshWindows()
  }, [refreshWindows])

  function selectWindow(win) {
    setSelected(win)
    setAutoCreateScene(true)
    setNewGame((g) => ({
      ...g,
      name: win.process,
      selector: win.title,
      exe: win.exe,
      windowClass: win.windowClass,
      windowMatchPriority: 0,
      scene: win.process,
    }))
    api
      .extractWindowIcon(win.process)
      .then((iconPath) => {
        if (iconPath) setNewGame((g) => ({ ...g, icon_path: iconPath }))
      })
      .catch(() => {})
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add Game</h2>
        <p>Select a running window to add as a game.</p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {loadingWindows ? 'Loading windows...' : `${visibleWindows.length} window${visibleWindows.length !== 1 ? 's' : ''} found`}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={refreshWindows}
            disabled={loadingWindows}
            title="Refresh window list"
          >
            <RefreshCw size={13} className={loadingWindows ? 'spinning' : ''} />
          </button>
        </div>

        <div
          style={{
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-sm)',
            maxHeight: 320,
            overflowY: 'auto',
            background: 'var(--bg-tertiary)',
          }}
        >
          {loadingWindows && visibleWindows.length === 0 ? (
            <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              Loading...
            </div>
          ) : visibleWindows.length === 0 ? (
            <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              No windows found. Make sure your game is running, then refresh.
            </div>
          ) : (
            visibleWindows.map((win, i) => {
              const isSelected = selected && selected.title === win.title && selected.exe === win.exe
              return (
                <div
                  key={i}
                  onClick={() => selectWindow(win)}
                  style={{
                    padding: '8px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                    borderBottom: i < visibleWindows.length - 1 ? '1px solid var(--border)' : 'none',
                    background: isSelected ? 'var(--bg-hover)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {win.title}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 1 }}>
                      {win.process}{win.exe && win.exe !== win.process ? ` · ${win.exe}` : ''}
                    </div>
                  </div>
                  {isSelected && (
                    <Check size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  )}
                </div>
              )
            })
          )}
        </div>

        {selected && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
            Will add <strong style={{ color: 'var(--text-primary)' }}>{newGame.name}</strong> linked to OBS scene{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{newGame.scene}</strong>.
          </div>
        )}

        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onSwitchToAdvanced}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 11,
              color: 'var(--text-muted)',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
            title="Switch to advanced game setup"
          >
            Advanced
          </button>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onAddGame}
            disabled={!selected}
          >
            Add Game
          </button>
        </div>
      </div>
    </div>
  )
}
