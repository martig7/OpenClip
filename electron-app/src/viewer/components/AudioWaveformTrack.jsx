import { useRef, useEffect, useCallback } from 'react'

function AudioWaveformTrack({
  peaks,
  duration,
  viewStart,
  visibleDuration,
  masterWidth,
  clipStart,
  clipEnd,
  isSelected,
  onClick,
  label,
  detail,
}) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (onClick) {
          onClick(event)
        }
      }
    },
    [onClick]
  )

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const W = Math.floor(container.clientWidth * (window.devicePixelRatio || 1))
    if (W > 0 && canvas.width !== W) canvas.width = W

    const ctx = canvas.getContext('2d')
    const H = canvas.height
    ctx.clearRect(0, 0, canvas.width, H)

    if (!peaks || !peaks.length || !duration || !visibleDuration) return

    const midY = H / 2

    for (let px = 0; px < canvas.width; px++) {
      const t = viewStart + (px / canvas.width) * visibleDuration
      const peakIdx = Math.floor((t / duration) * peaks.length)
      if (peakIdx < 0 || peakIdx >= peaks.length) continue
      const barH = Math.max(1, peaks[peakIdx] * midY * 0.9)
      
      const isInsideClip = (clipStart != null && clipEnd != null) ? (t >= clipStart && t <= clipEnd) : true;
      ctx.fillStyle = (isSelected && isInsideClip) ? 'rgba(139, 92, 246, 0.85)' : 'rgba(100, 116, 139, 0.5)'
      ctx.fillRect(px, midY - barH, 1, barH * 2)
    }
  }, [peaks, duration, viewStart, visibleDuration, masterWidth, clipStart, clipEnd, isSelected])

  useEffect(() => {
    const id = setTimeout(() => draw(), 50)
    return () => clearTimeout(id)
  }, [draw])

  // Redraw on container resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  const clipStartX = ((clipStart - viewStart) / visibleDuration) * 100
  const clipEndX = ((clipEnd - viewStart) / visibleDuration) * 100

  return (
    <div
      ref={containerRef}
      className={`audio-waveform-track${isSelected ? ' selected' : ''}`}
      style={{
        width: masterWidth ? `${masterWidth}px` : '100%',
        maxWidth: masterWidth ? `${masterWidth}px` : '100%',
      }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      title={isSelected ? 'Click to deselect track' : 'Click to select track'}
    >
      {isSelected && clipStart != null && clipEnd != null && masterWidth > 0 && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none z-0"
          style={{
            left: `${Math.max(0, Math.min(100, clipStartX))}%`,
            width: `${Math.max(0, Math.min(100, clipEndX)) - Math.max(0, Math.min(100, clipStartX))}%`,
            background: 'var(--accent-muted)',
            border: '2px solid var(--accent)',
            borderRadius: '6px'
          }}
        />
      )}
      <div className="audio-waveform-info">
        <span className="track-name">{label}</span>
        <span className="track-detail">{detail}</span>
      </div>
      <canvas ref={canvasRef} className="audio-waveform-canvas" style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

export default AudioWaveformTrack
