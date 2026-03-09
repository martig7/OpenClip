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
  onSelectedTracksChange
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
    if (time >= 0 && time < clipEnd) {
      onClipStartChange(Math.min(time, duration))
    }
  }, [clipEnd, duration, onClipStartChange])

  const handleEndChange = useCallback((e) => {
    const time = parseTime(e.target.value)
    if (time > clipStart && time <= duration) {
      onClipEndChange(time)
    }
  }, [clipStart, duration, onClipEndChange])

  const clipDuration = clipEnd - clipStart

  const toggleTrack = useCallback((index) => {
    if (!onSelectedTracksChange) return
    onSelectedTracksChange(prev => {
      if (prev.includes(index)) {
        if (prev.length <= 1) return prev // must keep at least one
        return prev.filter(i => i !== index)
      }
      return [...prev, index].sort((a, b) => a - b)
    })
  }, [onSelectedTracksChange])

  return (
    <div className="clip-controls">
      <div className="clip-controls-header">
        <h3>&#9986; Create Clip</h3>
      </div>

      <div className="clip-times">
        <div className="clip-time-input">
          <label>Start</label>
          <input
            type="text"
            value={formatTime(clipStart)}
            onChange={handleStartChange}
            disabled={isCreating}
          />
        </div>

        <div className="clip-time-input">
          <label>End</label>
          <input
            type="text"
            value={formatTime(clipEnd)}
            onChange={handleEndChange}
            disabled={isCreating}
          />
        </div>

        <div className="clip-duration">
          <span>Duration: {formatTime(clipDuration)}</span>
        </div>
      </div>

      {audioTracks.length > 1 && (
        <div className="clip-tracks">
          <label className="clip-tracks-label">Audio Tracks</label>
          <div className="track-list">
            {audioTracks.map((track, i) => (
              <label key={i} className="track-item">
                <input
                  type="checkbox"
                  checked={selectedTracks.includes(i)}
                  onChange={() => toggleTrack(i)}
                  disabled={isCreating}
                />
                <span className="track-name">{track.title || `Track ${i + 1}`}</span>
                <span className="track-detail">{track.codec_name} · {track.channels}ch</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="clip-actions">
        <button
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={isCreating}
        >
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={onCreate}
          disabled={isCreating || clipDuration <= 0}
        >
          {isCreating ? (
            <>
              <span className="spinner" style={{ width: 16, height: 16 }} />
              Creating...
            </>
          ) : (
            <>&#9986; Create Clip</>
          )}
        </button>
      </div>
    </div>
  )
}

export default ClipControls
