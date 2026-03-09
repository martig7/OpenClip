import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import AudioWaveformTrack from './AudioWaveformTrack'

function ZoomTimeline({
  currentTime,
  duration,
  onSeek,
  clipStart,
  clipEnd,
  onClipStartChange,
  onClipEndChange,
  markers = [],
  onMarkerClick,
  audioTracks = [],
  selectedTracks = [],
  waveforms = {},
  onTrackToggle,
  isCreatingClip = false,
}) {
  const containerRef = useRef(null)
  const [zoom, setZoom] = useState(4) // how many times zoomed in (1 = full, higher = more zoomed)
  const [viewCenter, setViewCenter] = useState(0) // center of visible range in seconds
  const [containerWidth, setContainerWidth] = useState(800)
  const [isDragging, setIsDragging] = useState(false)
  const [dragType, setDragType] = useState(null) // 'seek', 'clipStart', 'clipEnd', 'pan'
  const [panStartX, setPanStartX] = useState(0)
  const [panStartCenter, setPanStartCenter] = useState(0)

  const MIN_ZOOM = 1
  const MAX_ZOOM = 40
  const TIMELINE_HEIGHT = 64

  // Initialize view center to clip region
  useEffect(() => {
    setViewCenter((clipStart + clipEnd) / 2)
  }, []) // only on mount

  // Track container width for tick computation
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    const ro = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Visible time range
  const visibleDuration = duration / zoom
  const viewStart = Math.max(0, viewCenter - visibleDuration / 2)
  const viewEnd = Math.min(duration, viewStart + visibleDuration)
  const actualViewStart = viewEnd === duration ? Math.max(0, duration - visibleDuration) : viewStart

  // Convert pixel position to time
  const xToTime = useCallback((clientX) => {
    if (!containerRef.current || !duration) return 0
    const rect = containerRef.current.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    const time = actualViewStart + ratio * visibleDuration
    return Math.max(0, Math.min(duration, time))
  }, [actualViewStart, visibleDuration, duration])

  // Time ruler tick marks
  const ticks = useMemo(() => {
    if (!duration) return []

    const pixelsPerSecond = containerWidth / visibleDuration

    // Choose tick interval based on zoom level
    let interval
    if (pixelsPerSecond > 200) interval = 0.5
    else if (pixelsPerSecond > 100) interval = 1
    else if (pixelsPerSecond > 40) interval = 5
    else if (pixelsPerSecond > 15) interval = 10
    else if (pixelsPerSecond > 5) interval = 30
    else interval = 60

    // Major ticks at larger intervals
    const majorInterval = interval >= 10 ? interval * 3 : interval * 5

    const result = []
    const start = Math.floor(actualViewStart / interval) * interval
    for (let t = start; t <= viewEnd + interval; t += interval) {
      if (t < 0 || t > duration) continue
      const x = ((t - actualViewStart) / visibleDuration) * 100
      if (x < -5 || x > 105) continue

      const isMajor = Math.abs(t % majorInterval) < 0.01 || Math.abs(t % majorInterval - majorInterval) < 0.01
      result.push({ time: t, x, isMajor })
    }
    return result
  }, [duration, actualViewStart, visibleDuration, viewEnd, containerWidth])

  const formatTickTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (secs === Math.floor(secs)) {
      return `${mins}:${Math.floor(secs).toString().padStart(2, '0')}`
    }
    return `${mins}:${secs.toFixed(1).padStart(4, '0')}`
  }

  // Mouse handlers
  const handleMouseDown = useCallback((e, type = 'seek') => {
    e.preventDefault()
    e.stopPropagation()

    if (type === 'pan') {
      setIsDragging(true)
      setDragType('pan')
      setPanStartX(e.clientX)
      setPanStartCenter(viewCenter)
      return
    }

    setIsDragging(true)
    setDragType(type)

    const time = xToTime(e.clientX)
    if (type === 'seek') {
      onSeek(time)
    } else if (type === 'clipStart') {
      onClipStartChange(Math.min(time, clipEnd - 0.1))
    } else if (type === 'clipEnd') {
      onClipEndChange(Math.max(time, clipStart + 0.1))
    }
  }, [xToTime, onSeek, clipStart, clipEnd, onClipStartChange, onClipEndChange, viewCenter])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e) => {
      if (dragType === 'pan') {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const dx = e.clientX - panStartX
        const timeDelta = (dx / rect.width) * visibleDuration
        const newCenter = Math.max(
          visibleDuration / 2,
          Math.min(duration - visibleDuration / 2, panStartCenter - timeDelta)
        )
        setViewCenter(newCenter)
        return
      }

      const time = xToTime(e.clientX)
      if (dragType === 'seek') {
        onSeek(time)
      } else if (dragType === 'clipStart') {
        onClipStartChange(Math.min(time, clipEnd - 0.1))
      } else if (dragType === 'clipEnd') {
        onClipEndChange(Math.max(time, clipStart + 0.1))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setDragType(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, dragType, xToTime, onSeek, clipStart, clipEnd, onClipStartChange, onClipEndChange, panStartX, panStartCenter, visibleDuration, duration])

  // Scroll to zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -1 : 1
    const factor = 1.25

    setZoom(prev => {
      const newZoom = delta > 0 ? prev * factor : prev / factor
      return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom))
    })

    // Zoom toward mouse position
    if (containerRef.current) {
      const time = xToTime(e.clientX)
      setViewCenter(prev => {
        const blend = 0.3
        return prev * (1 - blend) + time * blend
      })
    }
  }, [xToTime])

  // Attach non-passive wheel listener
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // Zoom controls
  const zoomIn = () => setZoom(prev => Math.min(MAX_ZOOM, prev * 1.5))
  const zoomOut = () => setZoom(prev => Math.max(MIN_ZOOM, prev / 1.5))
  const zoomFit = () => {
    // Fit the clip region in view with some padding
    const clipDuration = clipEnd - clipStart
    const padding = clipDuration * 0.3
    const targetDuration = clipDuration + padding * 2
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, duration / targetDuration))
    setZoom(newZoom)
    setViewCenter((clipStart + clipEnd) / 2)
  }

  // Clip percentages in visible range
  const clipStartX = ((clipStart - actualViewStart) / visibleDuration) * 100
  const clipEndX = ((clipEnd - actualViewStart) / visibleDuration) * 100
  const playheadX = ((currentTime - actualViewStart) / visibleDuration) * 100

  // Mini-map: shows the full timeline with a viewport indicator
  const miniMapViewStart = (actualViewStart / duration) * 100
  const miniMapViewWidth = (visibleDuration / duration) * 100

  return (
    <div className="zoom-timeline-wrapper">
      {/* Zoom controls row */}
      <div className="zoom-controls-row">
        <div className="zoom-controls-left">
          <span className="zoom-label">Timeline Zoom</span>
          <button className="zoom-btn" onClick={zoomOut} title="Zoom out">-</button>
          <div className="zoom-level-bar">
            <input
              type="range"
              min={Math.log(MIN_ZOOM)}
              max={Math.log(MAX_ZOOM)}
              step="0.01"
              value={Math.log(zoom)}
              onChange={(e) => setZoom(Math.exp(parseFloat(e.target.value)))}
            />
          </div>
          <button className="zoom-btn" onClick={zoomIn} title="Zoom in">+</button>
          <span className="zoom-value">{zoom.toFixed(1)}x</span>
          <button className="zoom-btn zoom-fit-btn" onClick={zoomFit} title="Fit clip in view">Fit Clip</button>
        </div>

        {/* Mini-map */}
        <div
          className="zoom-minimap"
          onMouseDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const ratio = (e.clientX - rect.left) / rect.width
            setViewCenter(Math.max(visibleDuration / 2, Math.min(duration - visibleDuration / 2, ratio * duration)))
          }}
        >
          <div className="minimap-clip" style={{
            left: `${(clipStart / duration) * 100}%`,
            width: `${((clipEnd - clipStart) / duration) * 100}%`
          }} />
          <div className="minimap-playhead" style={{
            left: `${(currentTime / duration) * 100}%`
          }} />
          <div className="minimap-viewport" style={{
            left: `${miniMapViewStart}%`,
            width: `${Math.max(2, miniMapViewWidth)}%`
          }} />
        </div>
      </div>

      {/* Time ruler */}
      <div className="zoom-ruler">
        {ticks.map((tick, i) => (
          <div
            key={i}
            className={`ruler-tick ${tick.isMajor ? 'major' : 'minor'}`}
            style={{ left: `${tick.x}%` }}
          >
            {tick.isMajor && (
              <span className="ruler-label">{formatTickTime(tick.time)}</span>
            )}
          </div>
        ))}
      </div>

      {/* Main zoomed timeline area */}
      <div
        ref={containerRef}
        className="zoom-timeline-track"
        style={{ height: TIMELINE_HEIGHT }}
        onMouseDown={(e) => {
          // Middle mouse or if holding space: pan
          if (e.button === 1) {
            handleMouseDown(e, 'pan')
          } else {
            handleMouseDown(e, 'seek')
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Background grid lines */}
        {ticks.filter(t => t.isMajor).map((tick, i) => (
          <div
            key={i}
            className="zoom-grid-line"
            style={{ left: `${tick.x}%` }}
          />
        ))}

        {/* Clip region */}
        <div
          className="zoom-clip-region"
          style={{
            left: `${Math.max(0, clipStartX)}%`,
            width: `${Math.min(100, clipEndX) - Math.max(0, clipStartX)}%`
          }}
        />

        {/* Clip start handle */}
        <div
          className="zoom-clip-handle start"
          style={{ left: `${clipStartX}%` }}
          onMouseDown={(e) => {
            e.stopPropagation()
            handleMouseDown(e, 'clipStart')
          }}
        >
          <div className="handle-grip">
            <span /><span /><span />
          </div>
        </div>

        {/* Clip end handle */}
        <div
          className="zoom-clip-handle end"
          style={{ left: `${clipEndX}%` }}
          onMouseDown={(e) => {
            e.stopPropagation()
            handleMouseDown(e, 'clipEnd')
          }}
        >
          <div className="handle-grip">
            <span /><span /><span />
          </div>
        </div>

        {/* Markers */}
        {markers.map((marker, index) => {
          const mx = ((marker.position - actualViewStart) / visibleDuration) * 100
          if (mx < -2 || mx > 102) return null
          return (
            <div
              key={`${marker.timestamp}-${index}`}
              className="zoom-marker"
              style={{ left: `${mx}%` }}
              onClick={(e) => {
                e.stopPropagation()
                onMarkerClick?.(marker.position)
              }}
              title={`Marker at ${formatTickTime(marker.position)}`}
            />
          )
        })}

        {/* Playhead */}
        {playheadX >= -1 && playheadX <= 101 && (
          <div
            className="zoom-playhead"
            style={{ left: `${playheadX}%` }}
          >
            <div className="playhead-head" />
            <div className="playhead-line" />
          </div>
        )}
      </div>

      {/* Audio waveform tracks */}
      {audioTracks.length > 0 && (
        <div className="audio-waveform-panel">
          {audioTracks.map((track, i) => (
            <AudioWaveformTrack
              key={i}
              peaks={waveforms[i] || null}
              duration={duration}
              viewStart={actualViewStart}
              visibleDuration={visibleDuration}
              isSelected={selectedTracks.includes(i)}
              onClick={() => {
                if (!isCreatingClip) {
                  onTrackToggle?.(i)
                }
              }}
              label={track.title || `Track ${i + 1}`}
              detail={`${track.codec_name} · ${track.channels}ch`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default ZoomTimeline
