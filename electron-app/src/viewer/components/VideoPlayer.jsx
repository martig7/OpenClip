import { useRef, useState, useEffect, useCallback } from 'react'
import {
  Film,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Volume2,
  VolumeX,
  MoveRight,
  Maximize,
  Minimize,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import Timeline from './Timeline'
import ZoomTimeline from './ZoomTimeline'
import VideoPlayerInfoBar from './VideoPlayerInfoBar'
import { apiFetch, apiPost, getBase } from '../apiBase'
import { formatTime } from '../utils'
import api from '../../api'
import { useOrganizeProgress } from '../../App'

function VideoPlayer({
  recording,
  clip,
  onClipCreated,
  onDelete,
  games = [],
  onOrganized,
  onOrganizeError,
  organizeRemux = true,
}) {
  // Use recording if provided, otherwise fall back to clip (for clips page)
  const media = recording || clip

  const videoRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)

  // Whether the media was passed as a clip (vs a recording)
  const isClip = !!clip

  // Hover controls state
  const [showControls, setShowControls] = useState(false)

  // Clip mode state
  const [clipMode, setClipMode] = useState(false)
  const [clipStart, setClipStart] = useState(0)
  const [clipEnd, setClipEnd] = useState(30)
  const [isCreatingClip, setIsCreatingClip] = useState(false)
  const [isZoomTimelineExpanded, setIsZoomTimelineExpanded] = useState(false)
  const zoomTimelineRef = useRef(null)

  // Markers state
  const [markers, setMarkers] = useState([])

  // Audio tracks state
  const [audioTracks, setAudioTracks] = useState([])
  const [selectedTracks, setSelectedTracks] = useState([])
  const [waveforms, setWaveforms] = useState({})
  const [waveformResolution, setWaveformResolution] = useState('default')

  // In-memory waveform cache (cleared when media changes)
  const waveformCacheRef = useRef(new Map())

  // Organize state
  const [organizeMode, setOrganizeMode] = useState(false)
  const [organizeGame, setOrganizeGame] = useState('')
  const [isOrganizing, setIsOrganizing] = useState(false)

  const [isFullscreen, setIsFullscreen] = useState(false)

  // organizeProgress lives in OrganizeProgressContext so App can show the
  // global popup when the user navigates away mid-organize.
  const { setIsManualOrganizing, organizeProgress, setOrganizeProgress } = useOrganizeProgress()

  const isUnorganized = media?.game_name === '(Unorganized)'

  // Reset state when media changes
  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setClipMode(false)
    setIsZoomTimelineExpanded(false)
    setMarkers([])
    setAudioTracks([])
    setSelectedTracks([])
    setWaveforms({})
    setOrganizeMode(false)
    setOrganizeGame('')
    waveformCacheRef.current.clear()
  }, [media])

  // Fetch waveform resolution setting
  useEffect(() => {
    const loadWaveformResolution = async () => {
      const s = await api.getStore('settings')
      if (s?.waveformResolution) {
        setWaveformResolution(s.waveformResolution)
      }
    }
    loadWaveformResolution()
  }, [])

  // Fetch audio tracks when media changes
  useEffect(() => {
    if (!media) return

    let cancelled = false
    let abortController = new AbortController()

    const fetchTracks = async () => {
      try {
        const response = await apiFetch(`/api/video/tracks?path=${encodeURIComponent(media.path)}`, {
          signal: abortController.signal
        })
        if (cancelled) return
        const data = await response.json()
        if (cancelled) return
        if (response.ok && data.tracks) {
          setAudioTracks(data.tracks)
          setSelectedTracks(data.tracks.map((_, i) => i))

          // Fetch waveforms in parallel with concurrent requests
          const waveformPromises = data.tracks.map(async (track, trackIndex) => {
            if (cancelled) return null

            // Check in-memory cache first
            const cacheKey = `${media.path}:${trackIndex}:${waveformResolution}`
            const cached = waveformCacheRef.current.get(cacheKey)
            if (cached) {
              setWaveforms((prev) => ({ ...prev, [trackIndex]: cached.peaks }))
              return { trackIndex, peaks: cached.peaks }
            }

            try {
              const waveRes = await apiFetch(
                `/api/video/waveform?path=${encodeURIComponent(media.path)}&track=${trackIndex}&resolution=${waveformResolution}`,
                {
                  signal: abortController.signal
                }
              )
              if (cancelled) return null
              const waveData = await waveRes.json()
              if (cancelled) return null
              if (waveRes.ok && waveData.peaks?.length) {
                // Cache in memory
                waveformCacheRef.current.set(cacheKey, { peaks: waveData.peaks })
                setWaveforms((prev) => ({ ...prev, [trackIndex]: waveData.peaks }))
                return { trackIndex, peaks: waveData.peaks }
              }
            } catch (e) {
              // Ignore abort errors
              if (e.name !== 'AbortError') {
                console.error(`Failed to fetch waveform for track ${trackIndex}:`, e)
              }
            }
            return null
          })

          await Promise.allSettled(waveformPromises)
        }
      } catch (error) {
        // Ignore abort errors
        if (!cancelled && error.name !== 'AbortError') {
          console.error('Failed to fetch audio tracks:', error)
        }
      }
    }

    fetchTracks()
    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [media, waveformResolution])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const container = videoRef.current?.closest('.player-container')
    if (!container) return

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`)
      })
    } else {
      document.exitFullscreen()
    }
  }, [])

  // Fetch markers when media changes and duration is known
  useEffect(() => {
    if (!media || !duration) return

    const fetchMarkers = async () => {
      try {
        const response = await apiFetch(
          `/api/markers?path=${encodeURIComponent(media.path)}&game_name=${encodeURIComponent(media.game_name)}`
        )
        const data = await response.json()
        if (response.ok && data.markers) {
          setMarkers(data.markers)
        }
      } catch (error) {
        console.error('Failed to fetch markers:', error)
      }
    }

    fetchMarkers()
  }, [media, duration])

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
    }
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration)
      setClipEnd(Math.min(30, videoRef.current.duration))
    }
  }, [])

  const handlePlay = useCallback(() => setIsPlaying(true), [])
  const handlePause = useCallback(() => setIsPlaying(false), [])

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
    }
  }, [isPlaying])

  const handleSeek = useCallback((time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time
      setCurrentTime(time)
    }
  }, [])

  const handleVolumeChange = useCallback((newVolume) => {
    if (videoRef.current) {
      videoRef.current.volume = newVolume
      setVolume(newVolume)
      setIsMuted(newVolume === 0)
    }
  }, [])

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      if (isMuted) {
        videoRef.current.volume = volume || 1
        setIsMuted(false)
      } else {
        videoRef.current.volume = 0
        setIsMuted(true)
      }
    }
  }, [isMuted, volume])

  const skip = useCallback(
    (seconds) => {
      if (videoRef.current) {
        const newTime = Math.max(0, Math.min(duration, currentTime + seconds))
        videoRef.current.currentTime = newTime
      }
    },
    [currentTime, duration]
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in an input
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10)
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (videoRef.current) {
            videoRef.current.currentTime = Math.min(
              videoRef.current.duration || 0,
              videoRef.current.currentTime + 10
            )
          }
          break
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'm':
        case 'M':
          e.preventDefault()
          toggleMute()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlay, toggleMute])

  // Hover controls handlers
  const handleVideoMouseEnter = useCallback(() => {
    setShowControls(true)
  }, [])

  const handleVideoMouseLeave = useCallback(() => {
    setShowControls(false)
  }, [])

  const handleVideoMouseMove = useCallback(() => {
    setShowControls(true)
  }, [])

  // Keep controls visible when timeline is being hovered
  const handleTimelineHover = useCallback(() => {
    setShowControls(true)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {}
  }, [])

  const handleMarkerClick = useCallback(
    (position) => {
      handleSeek(position)
      if (videoRef.current && !isPlaying) {
        videoRef.current.play()
      }
    },
    [handleSeek, isPlaying]
  )

  const enterClipMode = useCallback(() => {
    setClipMode(true)
    setIsZoomTimelineExpanded(false)
    const half = 15
    const start = Math.max(0, currentTime - half)
    const end = Math.min(duration, currentTime + half)
    setClipStart(start)
    setClipEnd(end)
    
    // Zoom to fit region after component mounts
    setTimeout(() => {
      if (zoomTimelineRef.current) {
        zoomTimelineRef.current.zoomFit()
      }
    }, 50)
  }, [currentTime, duration])

  const exitClipMode = useCallback(() => {
    setClipMode(false)
    // Reset track selection so all tracks play when not in clip mode
    setSelectedTracks(audioTracks.map((_, i) => i))
  }, [audioTracks])

  const toggleTrack = useCallback((index) => {
    setSelectedTracks((prev) => {
      if (prev.includes(index)) {
        // Prevent deselecting the last selected track
        if (prev.length === 1) return prev
        return prev.filter((i) => i !== index)
      }
      return [...prev, index].sort((a, b) => a - b)
    })
  }, [])

  const handleCreateClip = useCallback(async () => {
    if (!media || isCreatingClip) return

    setIsCreatingClip(true)
    try {
      const response = await apiPost('/api/clips/create', {
        source_path: media.path,
        start_time: clipStart,
        end_time: clipEnd,
        game_name: media.game_name,
        audio_tracks:
          audioTracks.length > 1 &&
          selectedTracks.length > 0 &&
          selectedTracks.length < audioTracks.length
            ? selectedTracks
            : null,
      })

      const data = await response.json()

      if (response.ok) {
        setClipMode(false)
        setSelectedTracks(audioTracks.map((_, i) => i))
        if (onClipCreated) {
          onClipCreated(data)
        }
      } else {
        alert(`Failed to create clip: ${data.error}`)
      }
    } catch (error) {
      alert(`Error creating clip: ${error.message}`)
    } finally {
      setIsCreatingClip(false)
    }
  }, [recording, clipStart, clipEnd, isCreatingClip, onClipCreated, audioTracks, selectedTracks])

  // Subscribe to per-stage progress events from the backend
  useEffect(() => {
    const unsub = api.onOrganizeProgress?.((p) => setOrganizeProgress(p))
    return () => unsub?.()
  }, [])

  const handleOrganize = useCallback(async () => {
    if (!media || !organizeGame || isOrganizing) return
    setIsOrganizing(true)
    setIsManualOrganizing(true)
    setOrganizeProgress(null)
    try {
      const result = await api.organizeRecording(media.path, organizeGame, organizeRemux)
      if (result && result.success) {
        setOrganizeMode(false)
        if (onOrganized) onOrganized(result)
      } else {
        if (onOrganizeError) onOrganizeError(result?.error || 'Organize failed')
      }
    } catch (err) {
      if (onOrganizeError) onOrganizeError(err.message || 'Organize failed')
    } finally {
      setIsOrganizing(false)
      setIsManualOrganizing(false)
      setOrganizeProgress(null)
    }
  }, [
    media,
    organizeGame,
    organizeRemux,
    isOrganizing,
    setIsManualOrganizing,
    setOrganizeProgress,
    onOrganized,
    onOrganizeError,
  ])

  const handleOpenInPlayer = useCallback(() => {
    apiPost('/api/open-external', { path: media.path })
  }, [media])

  const handleShowInExplorer = useCallback(() => {
    apiPost('/api/show-in-explorer', { path: media.path })
  }, [media])

  if (!media) {
    return (
      <div className="flex-1 flex flex-col bg-[var(--bg-primary)] w-full h-full overflow-hidden">
        <div
          className="h-[36px] w-full shrink-0 border-b border-[var(--border)]"
          style={{ WebkitAppRegion: 'drag', backgroundColor: 'var(--bg-primary)' }}
        />
        <div className="player-container">
          <div className="player-placeholder">
            <div className="icon">
              <Film size={40} />
            </div>
            <p>Select a recording to play</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-primary)] w-full h-full overflow-hidden">
      <div
        className="h-[36px] w-full shrink-0 border-b border-[var(--border)] relative z-50"
        style={{ WebkitAppRegion: 'drag', backgroundColor: 'var(--bg-primary)' }}
      />
      <div
        className="player-container"
        onMouseEnter={handleVideoMouseEnter}
        onMouseLeave={handleVideoMouseLeave}
        onMouseMove={handleVideoMouseMove}
      >
        <video
          ref={videoRef}
          src={`${getBase()}/api/video?path=${encodeURIComponent(media.path)}`}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={handlePlay}
          onPause={handlePause}
          onClick={togglePlay}
        />

        <div className={`video-controls-overlay ${showControls || clipMode ? 'visible' : ''}`}>
          <Timeline
            currentTime={currentTime}
            duration={duration}
            onSeek={handleSeek}
            clipMode={clipMode}
            clipStart={clipStart}
            clipEnd={clipEnd}
            onClipStartChange={setClipStart}
            onClipEndChange={setClipEnd}
            markers={markers}
            onMarkerClick={handleMarkerClick}
            onHoverChange={handleTimelineHover}
          />

          <div className="controls-row">
            <button
              className="control-btn control-btn--play"
              onClick={togglePlay}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" />
              )}
            </button>
            <button
              className="control-btn control-btn--icon"
              onClick={() => skip(-10)}
              title="Rewind 10s"
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              className="control-btn control-btn--icon"
              onClick={() => skip(10)}
              title="Forward 10s"
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
            <span className="time-display">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            <div className="volume-control">
              <button
                className="control-btn control-btn--icon"
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <div className="volume-slider-container">
                <input
                  type="range"
                  className="volume-slider"
                  min="0"
                  max="1"
                  step="0.1"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                />
                <div
                  className="volume-slider-fill"
                  style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
                />
                <div
                  className="volume-slider-thumb"
                  style={{ left: `${(isMuted ? 0 : volume) * 100}%` }}
                />
              </div>
              <button
                className="control-btn control-btn--icon ml-2"
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {clipMode && (
    <div className="clip-creation-container w-full flex flex-col z-50 shrink-0 border-t border-[var(--border)] relative">
      {audioTracks.length > 0 && (
        <button 
          className="zoom-timeline-toggle-btn"
          onClick={() => setIsZoomTimelineExpanded(!isZoomTimelineExpanded)}
        >
          <span className="text-xs font-semibold">Tracks</span>
          {isZoomTimelineExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      )}
      <ZoomTimeline
        ref={zoomTimelineRef}
        currentTime={currentTime}
        duration={duration}
        onSeek={handleSeek}
        clipStart={clipStart}
        clipEnd={clipEnd}
        onClipStartChange={setClipStart}
        onClipEndChange={setClipEnd}
        markers={markers}
        onMarkerClick={handleMarkerClick}
        audioTracks={audioTracks}
        selectedTracks={selectedTracks}
        waveforms={waveforms}
        onTrackToggle={toggleTrack}
        isCreatingClip={isCreatingClip}
        isExpanded={isZoomTimelineExpanded}
      />
    </div>
      )}

      <div className="flex flex-col bg-[var(--bg-primary)] w-full shrink-0">
        <VideoPlayerInfoBar
          media={media}
          isUnorganized={isUnorganized}
          isClipMode={clipMode}
          organizeMode={organizeMode}
          setOrganizeMode={setOrganizeMode}
          isOrganizing={isOrganizing}
          clipStart={clipStart}
          clipEnd={clipEnd}
          isZoomTimelineExpanded={isZoomTimelineExpanded}
          setIsZoomTimelineExpanded={setIsZoomTimelineExpanded}
          onZoomIn={() => zoomTimelineRef.current?.zoomIn()}
          onZoomOut={() => zoomTimelineRef.current?.zoomOut()}
          onZoomFit={() => zoomTimelineRef.current?.zoomFit()}
          isClip={isClip}
          enterClipMode={isClip ? undefined : enterClipMode}
          exitClipMode={exitClipMode}
          handleCreateClip={handleCreateClip}
          isCreatingClip={isCreatingClip}
          onDelete={onDelete}
          handleOpenInPlayer={handleOpenInPlayer}
          handleShowInExplorer={handleShowInExplorer}
        />

        {organizeMode && !clipMode && (
          <div className="organize-panel">
            <div className="organize-header">
              <MoveRight size={13} />
              Move to another game
            </div>
            <div className="organize-row">
              <select
                className="organize-select"
                value={organizeGame}
                onChange={(e) => setOrganizeGame(e.target.value)}
                disabled={isOrganizing}
              >
                <option value="">— Select game —</option>
                {games.map((g) => (
                  <option key={g.id} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-organize"
                onClick={handleOrganize}
                disabled={!organizeGame || isOrganizing}
              >
                {isOrganizing ? (
                  <>
                    <div className="spinner-sm" /> Organizing…
                  </>
                ) : (
                  <>
                    <MoveRight size={13} /> Organize
                  </>
                )}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setOrganizeMode(false)}
                disabled={isOrganizing}
              >
                Cancel
              </button>
            </div>
            {isOrganizing && (
              <div className="organize-progress">
                <div className="organize-progress-label">
                  <div
                    className="spinner-sm"
                    style={{ borderColor: 'rgba(245,158,11,0.25)', borderTopColor: 'var(--amber)' }}
                  />
                  {organizeProgress?.label ?? 'Starting…'}
                </div>
                <div className="progress-bar-container organize-progress-bar">
                  <div
                    className="progress-bar-fill organize-progress-fill"
                    style={{
                      width: `${organizeProgress?.stage === 'moving' ? 90 : organizeProgress?.stage === 'remuxing' ? 65 : 20}%`,
                    }}
                  />
                </div>
              </div>
            )}
            {organizeGame && !isOrganizing && (
              <div className="organize-preview">
                {(() => {
                  const ext = media?.path ? media.path.split('.').pop().toLowerCase() : ''
                  const willRemux = organizeRemux && ext !== 'mp4'
                  return (
                    <>
                      Will be saved as: <strong>{organizeGame}</strong> Session &gt; Week folder
                      {willRemux
                        ? ' › remuxed to MP4'
                        : ext
                          ? ` › ${ext.toUpperCase()} (move only)`
                          : ' › MP4'}
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default VideoPlayer
