import { useRef, useCallback, useState, useEffect } from 'react'

function Timeline({
  currentTime,
  duration,
  onSeek,
  clipMode,
  clipStart,
  clipEnd,
  onClipStartChange,
  onClipEndChange,
  markers = [],
  onMarkerClick
}) {
  const timelineRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragType, setDragType] = useState(null) // 'seek', 'clipStart', 'clipEnd'

  const getTimeFromPosition = useCallback((clientX) => {
    if (!timelineRef.current || !duration) return 0
    const rect = timelineRef.current.getBoundingClientRect()
    const position = (clientX - rect.left) / rect.width
    return Math.max(0, Math.min(duration, position * duration))
  }, [duration])

  const handleMouseDown = useCallback((e, type = 'seek') => {
    e.preventDefault()
    setIsDragging(true)
    setDragType(type)

    const time = getTimeFromPosition(e.clientX)

    if (type === 'seek') {
      onSeek(time)
    } else if (type === 'clipStart') {
      onClipStartChange(Math.min(time, clipEnd - 1))
    } else if (type === 'clipEnd') {
      onClipEndChange(Math.max(time, clipStart + 1))
    }
  }, [getTimeFromPosition, onSeek, clipStart, clipEnd, onClipStartChange, onClipEndChange])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e) => {
      const time = getTimeFromPosition(e.clientX)

      if (dragType === 'seek') {
        onSeek(time)
      } else if (dragType === 'clipStart') {
        onClipStartChange(Math.min(time, clipEnd - 1))
      } else if (dragType === 'clipEnd') {
        onClipEndChange(Math.max(time, clipStart + 1))
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
  }, [isDragging, dragType, getTimeFromPosition, onSeek, clipStart, clipEnd, onClipStartChange, onClipEndChange])

  const progressPercent = duration ? (currentTime / duration) * 100 : 0
  const clipStartPercent = duration ? (clipStart / duration) * 100 : 0
  const clipEndPercent = duration ? (clipEnd / duration) * 100 : 0

  return (
    <div
      ref={timelineRef}
      className="timeline-container"
      onMouseDown={(e) => handleMouseDown(e, 'seek')}
    >
      {/* Progress bar */}
      <div
        className="timeline-progress"
        style={{ width: `${progressPercent}%` }}
      />

      {/* Clip region (when in clip mode) */}
      {clipMode && (
        <>
          <div
            className="clip-region"
            style={{
              left: `${clipStartPercent}%`,
              width: `${clipEndPercent - clipStartPercent}%`
            }}
          />
          <div
            className="clip-handle start"
            style={{ left: `${clipStartPercent}%` }}
            onMouseDown={(e) => {
              e.stopPropagation()
              handleMouseDown(e, 'clipStart')
            }}
          />
          <div
            className="clip-handle end"
            style={{ left: `${clipEndPercent}%` }}
            onMouseDown={(e) => {
              e.stopPropagation()
              handleMouseDown(e, 'clipEnd')
            }}
          />
        </>
      )}

      {/* Marker pins */}
      {markers.map((marker, index) => {
        const markerPercent = duration ? (marker.position / duration) * 100 : 0
        return (
          <div
            key={`${marker.timestamp}-${index}`}
            className="timeline-marker"
            style={{ left: `${markerPercent}%` }}
            onClick={(e) => {
              e.stopPropagation()
              onMarkerClick?.(marker.position)
            }}
            title={`Clip marker at ${Math.floor(marker.position / 60)}:${Math.floor(marker.position % 60).toString().padStart(2, '0')}`}
          />
        )
      })}

      {/* Current time handle */}
      <div
        className="timeline-handle"
        style={{ left: `${progressPercent}%` }}
      />
    </div>
  )
}

export default Timeline
