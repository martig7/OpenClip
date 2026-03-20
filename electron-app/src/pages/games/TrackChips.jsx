import { RefreshCw } from 'lucide-react'

/** Track label row aligned with TrackChips. */
export function TrackLabelHeader({ trackLabels, className = '' }) {
  return (
    <div className={`track-label-header ${className}`}>
      <div className="track-label-spacer" />
      <div className="track-chips-col">
        {[1, 2, 3, 4, 5, 6].map((num) => (
          <div key={num} className="track-label-cell">
            {trackLabels?.[num - 1] || `T${num}`}
          </div>
        ))}
      </div>
      <div className="track-action-col" />
    </div>
  )
}

/** Per-source track 1–6 toggles. */
export function TrackChips({ inputName, tracks, trackLabels, isLoading, onToggle }) {
  return (
    <div className="track-chips-col">
      {[1, 2, 3, 4, 5, 6].map((num) => {
        const active = tracks[String(num)] === true
        return (
          <button
            key={num}
            className={`scene-audio-track-chip ${active ? 'active' : ''}`}
            title={`${trackLabels?.[num - 1] || `Track ${num}`}: ${active ? 'active' : 'inactive'}`}
            disabled={isLoading}
            onClick={() => onToggle(inputName, num)}
            style={{ opacity: isLoading ? 0.6 : 1 }}
          >
            {num}
          </button>
        )
      })}
      {isLoading && (
        <RefreshCw size={11} className="spinning" style={{ color: 'var(--text-muted)' }} />
      )}
    </div>
  )
}
