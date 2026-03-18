import { useCallback } from 'react'
import { apiFetch } from '../apiBase'

function WaveformProgressBanner({ generation, status, audioTrackCount }) {
  const handleCancel = useCallback(async () => {
    if (generation?.jobId) {
      await apiFetch(`/api/waveform/cancel?jobId=${generation.jobId}`, { method: 'POST' })
    }
  }, [generation])

  if (!generation && !status?.isComplete) {
    return null
  }

  if (status?.isComplete && audioTrackCount > 0) {
    return null
  }

  if (generation) {
    const statusText = {
      queued: 'Waiting in queue…',
      processing: 'Generating waveforms…',
      complete: 'Waveforms ready',
      error: 'Generation failed',
    }[generation.status] || 'Processing…'

    const zoomLevelsText = {
      low: 'Low resolution',
      medium: 'Medium resolution',
      high: 'High resolution',
    }[generation.resolution] || generation.resolution

    return (
      <div className="waveform-progress-banner">
        <div className="waveform-progress-content">
          <div className="waveform-progress-info">
            <span className="waveform-progress-label">{statusText}</span>
            <span className="waveform-progress-resolution">{zoomLevelsText}</span>
          </div>
          {generation.status === 'processing' && (
            <div className="waveform-progress-bar-container">
              <div
                className="waveform-progress-bar"
                style={{ width: `${generation.progress || 0}%` }}
              />
            </div>
          )}
          {generation.status === 'processing' && (
            <div className="waveform-progress-percentage">{generation.progress || 0}%</div>
          )}
          {(generation.status === 'queued' || generation.status === 'processing') && (
            <button
              className="waveform-progress-cancel"
              onClick={handleCancel}
              title="Cancel waveform generation"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    )
  }

  return null
}

export default WaveformProgressBanner
