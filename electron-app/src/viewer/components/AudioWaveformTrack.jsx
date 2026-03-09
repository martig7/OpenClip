import { useRef, useEffect, useCallback } from 'react'

function AudioWaveformTrack({ peaks, duration, viewStart, visibleDuration, isSelected, onClick, label, detail }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const W = container.clientWidth
    if (W > 0 && canvas.width !== W) canvas.width = W

    const ctx = canvas.getContext('2d')
    const H = canvas.height
    ctx.clearRect(0, 0, canvas.width, H)

    if (!peaks || !peaks.length || !duration || !visibleDuration) return

    const midY = H / 2
    ctx.fillStyle = isSelected ? 'rgba(139, 92, 246, 0.85)' : 'rgba(100, 116, 139, 0.5)'

    for (let px = 0; px < canvas.width; px++) {
      const t = viewStart + (px / canvas.width) * visibleDuration
      const peakIdx = Math.floor((t / duration) * peaks.length)
      if (peakIdx < 0 || peakIdx >= peaks.length) continue
      const barH = Math.max(1, peaks[peakIdx] * midY * 0.9)
      ctx.fillRect(px, midY - barH, 1, barH * 2)
    }
  }, [peaks, duration, viewStart, visibleDuration, isSelected])

  useEffect(() => {
    draw()
  }, [draw])

  // Redraw on container resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  return (
    <div
      ref={containerRef}
      className={`audio-waveform-track${isSelected ? ' selected' : ''}`}
      onClick={onClick}
      title={isSelected ? 'Click to deselect track' : 'Click to select track'}
    >
      <div className="audio-waveform-info">
        <span className="track-name">{label}</span>
        <span className="track-detail">{detail}</span>
      </div>
      <canvas ref={canvasRef} className="audio-waveform-canvas" height={48} />
    </div>
  )
}

export default AudioWaveformTrack
