import { useCallback } from 'react'
import { formatTime } from '../utils'

function ClipControls({
  clipStart,
  clipEnd,
  duration,
  onClipStartChange,
  onClipEndChange,
  onCancel,
  onCreate,
  isCreating
}) {

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
