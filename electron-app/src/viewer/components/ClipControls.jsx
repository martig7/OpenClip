import { useCallback } from 'react'

function ClipControls({
  clipStart,
  clipEnd,
  duration,
  onClipStartChange,
  onClipEndChange,
  onCancel,
  onCreate,
  isCreating,
  audioTracks = [],
  selectedTracks = [],
  tracksOpen = false,
  onTracksToggle,
}) {
  const formatTime = (seconds) => {
    if (!isFinite(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const parseTime = (timeStr) => {
    const parts = timeStr.split(':')
    if (parts.length === 2) {
      const mins = parseInt(parts[0], 10) || 0
      const secs = parseInt(parts[1], 10) || 0
      return mins * 60 + secs
    }
    return parseFloat(timeStr) || 0
  }

  const handleStartChange = useCallback((e) => {
    const time = parseTime(e.target.value)
    if (time >= 0 && time < clipEnd) onClipStartChange(Math.min(time, duration))
  }, [clipEnd, duration, onClipStartChange])

  const handleEndChange = useCallback((e) => {
    const time = parseTime(e.target.value)
    if (time > clipStart && time <= duration) onClipEndChange(time)
  }, [clipStart, duration, onClipEndChange])

  const clipDuration = clipEnd - clipStart

  return (
    <div className="clip-controls">
      <div className="clip-controls-row">
        <div className="clip-field">
          <label>Start</label>
          <input
            type="text"
            value={formatTime(clipStart)}
            onChange={handleStartChange}
            disabled={isCreating}
          />
        </div>

        <div className="clip-field">
          <label>End</label>
          <input
            type="text"
            value={formatTime(clipEnd)}
            onChange={handleEndChange}
            disabled={isCreating}
          />
        </div>

        <div className="clip-field clip-field--readonly">
          <label>Duration</label>
          <span>{formatTime(clipDuration)}</span>
        </div>

        {audioTracks.length > 1 && (
          <button
            className={`clip-tracks-toggle${tracksOpen ? ' open' : ''}`}
            onClick={onTracksToggle}
            title="Audio tracks"
          >
            &#9836; {selectedTracks.length}/{audioTracks.length}
            <span className="clip-tracks-chevron">{tracksOpen ? '▲' : '▼'}</span>
          </button>
        )}

        <div className="clip-actions">
          <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={isCreating}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={onCreate}
            disabled={isCreating || clipDuration <= 0}
          >
            {isCreating
              ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Creating…</>
              : <>&#9986; Create Clip</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ClipControls
