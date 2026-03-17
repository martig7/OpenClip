import { useRef, useState, useEffect, useCallback } from 'react'
import { Film, SkipBack, SkipForward, Play, Pause, Volume2, VolumeX, Folder, Calendar, HardDrive, Scissors, FolderOpen, MoveRight, Trash2 } from 'lucide-react'
import Timeline from './Timeline'
import ClipControls from './ClipControls'
import ZoomTimeline from './ZoomTimeline'
import { apiFetch, apiPost, getBase } from '../apiBase'
import { formatTime } from '../utils'
import api from '../../api'
import { useOrganizeProgress } from '../../App'

function VideoPlayer({ recording, clip, onClipCreated, onDelete, games = [], onOrganized, onOrganizeError, organizeRemux = true }) {
  // Use recording if provided, otherwise fall back to clip (for clips page)
  const media = recording || clip
  
  const videoRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)

  // Determine if this is clip mode (clips don't have clip creation/organize features)
  const isClipMode = !!clip

  // Hover controls state
  const [showControls, setShowControls] = useState(false)

  // Clip mode state
  const [clipMode, setClipMode] = useState(false)
  const [clipStart, setClipStart] = useState(0)
  const [clipEnd, setClipEnd] = useState(30)
  const [isCreatingClip, setIsCreatingClip] = useState(false)

  // Markers state
  const [markers, setMarkers] = useState([])

  // Audio tracks state
  const [audioTracks, setAudioTracks] = useState([])
  const [selectedTracks, setSelectedTracks] = useState([])
  const [waveforms, setWaveforms] = useState({})

  // Organize state
  const [organizeMode, setOrganizeMode] = useState(false)
  const [organizeGame, setOrganizeGame] = useState('')
  const [isOrganizing, setIsOrganizing] = useState(false)

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
    setMarkers([])
    setAudioTracks([])
    setSelectedTracks([])
    setWaveforms({})
    setOrganizeMode(false)
    setOrganizeGame('')
  }, [media])

  // Fetch audio tracks when media changes
  useEffect(() => {
    if (!media) return

    let cancelled = false

    const fetchTracks = async () => {
      try {
        const response = await apiFetch(
          `/api/video/tracks?path=${encodeURIComponent(media.path)}`
        )
        const data = await response.json()
        if (cancelled) return
        if (response.ok && data.tracks) {
          setAudioTracks(data.tracks)
          setSelectedTracks(data.tracks.map((_, i) => i))
          // Fetch waveforms sequentially to avoid CPU/IO spikes
          for (let i = 0; i < data.tracks.length; i++) {
            if (cancelled) break
            try {
              const waveRes = await apiFetch(
                `/api/video/waveform?path=${encodeURIComponent(media.path)}&track=${i}`
              )
              const waveData = await waveRes.json()
              if (cancelled) break
              if (waveRes.ok && waveData.peaks?.length) {
                setWaveforms(prev => ({ ...prev, [i]: waveData.peaks }))
              }
            } catch {}
          }
        }
      } catch (error) {
        console.error('Failed to fetch audio tracks:', error)
      }
    }

    fetchTracks()
    return () => { cancelled = true }
  }, [recording])

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

  const skip = useCallback((seconds) => {
    if (videoRef.current) {
      const newTime = Math.max(0, Math.min(duration, currentTime + seconds))
      videoRef.current.currentTime = newTime
    }
  }, [currentTime, duration])

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

  const handleMarkerClick = useCallback((position) => {
    handleSeek(position)
    if (videoRef.current && !isPlaying) {
      videoRef.current.play()
    }
  }, [handleSeek, isPlaying])

  const enterClipMode = useCallback(() => {
    setClipMode(true)
    const half = 15
    const start = Math.max(0, currentTime - half)
    const end = Math.min(duration, currentTime + half)
    setClipStart(start)
    setClipEnd(end)
  }, [currentTime, duration])

  const exitClipMode = useCallback(() => {
    setClipMode(false)
    // Reset track selection so all tracks play when not in clip mode
    setSelectedTracks(audioTracks.map((_, i) => i))
  }, [audioTracks])

  const toggleTrack = useCallback((index) => {
    setSelectedTracks(prev => {
      if (prev.includes(index)) {
        // Prevent deselecting the last selected track
        if (prev.length === 1) return prev
        return prev.filter(i => i !== index)
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
        audio_tracks: audioTracks.length > 1 && selectedTracks.length > 0 && selectedTracks.length < audioTracks.length
          ? selectedTracks : null
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
  }, [recording, organizeGame, organizeRemux, isOrganizing, setIsManualOrganizing, setOrganizeProgress, onOrganized, onOrganizeError])

  if (!media) {
    return (
      <div className="main-content">
        <div className="h-[36px] w-full shrink-0 border-b border-[var(--border)]" style={{ WebkitAppRegion: "drag", backgroundColor: "var(--bg-primary)" }} />
        <div className="player-container">
          <div className="player-placeholder">
            <div className="icon"><Film size={40} /></div>
            <p>Select a recording to play</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="main-content">
      <div className="h-[36px] w-full shrink-0 border-b border-[var(--border)] relative z-50" style={{ WebkitAppRegion: "drag", backgroundColor: "var(--bg-primary)" }} />
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
            
            <button className="control-btn control-btn--play" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
            <button className="control-btn control-btn--icon" onClick={() => skip(-10)} title="Rewind 10s">
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button className="control-btn control-btn--icon" onClick={() => skip(10)} title="Forward 10s">
              <SkipForward size={18} fill="currentColor" />
            </button>
            <span className="time-display">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            <div className="volume-control">
              <button className="control-btn control-btn--icon" onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
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
            </div>
          </div>
        </div>
      </div>

      {clipMode && (
        <div className="video-controls">
          <ZoomTimeline
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
          />

          <ClipControls
            clipStart={clipStart}
            clipEnd={clipEnd}
            duration={duration}
            onClipStartChange={setClipStart}
            onClipEndChange={setClipEnd}
            onCancel={exitClipMode}
            onCreate={handleCreateClip}
            isCreating={isCreatingClip}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col bg-[var(--bg-secondary)] w-full">
        <div className="video-info-bar border-t-0">
          <div className="video-info-top">
            <div>
              <h2 className="video-title">{media.filename}</h2>
              <div className="video-meta">
                <span><Folder size={13} /> {media.game_name}</span>
                <span><Calendar size={13} /> {media.date}</span>
                <span><HardDrive size={13} /> {media.size_formatted}</span>
              </div>
            </div>
            {isUnorganized && !isClipMode && (
              <span className="unorganized-badge">Unorganized</span>
            )}
          </div>
        <div className="action-buttons">
          {isUnorganized && !isClipMode && (
            <button
              className={`btn btn-organize${organizeMode ? ' active' : ''}`}
              onClick={() => setOrganizeMode(o => !o)}
              disabled={isOrganizing}
            >
              <MoveRight size={13} /> Organize
            </button>
          )}
          {!isClipMode && !isUnorganized && (
            <button className="btn btn-primary" onClick={enterClipMode}>
              <Scissors size={13} /> Create Clip
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => apiPost('/api/open-external', { path: media.path })}
          >
            <Play size={13} /> Open in Player
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => apiPost('/api/show-in-explorer', { path: media.path })}
          >
            <FolderOpen size={13} /> Show in Explorer
          </button>
          {isClipMode && onDelete && (
            <button
              className="btn btn-danger"
              onClick={onDelete}
            >
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      {isUnorganized && organizeMode && !isClipMode && (
        <div className="organize-panel">
          <div className="organize-header">
            <MoveRight size={13} />
            Move to organized library
          </div>
          <div className="organize-row">
            <select
              className="organize-select"
              value={organizeGame}
              onChange={e => setOrganizeGame(e.target.value)}
              disabled={isOrganizing}
            >
              <option value="">— Select game —</option>
              {games.map(g => (
                <option key={g.id} value={g.name}>{g.name}</option>
              ))}
            </select>
            <button
              className="btn btn-organize"
              onClick={handleOrganize}
              disabled={!organizeGame || isOrganizing}
            >
              {isOrganizing
                ? <><div className="spinner-sm" /> Organizing…</>
                : <><MoveRight size={13} /> Organize</>
              }
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
                <div className="spinner-sm" style={{ borderColor: 'rgba(245,158,11,0.25)', borderTopColor: 'var(--amber)' }} />
                {organizeProgress?.label ?? 'Starting…'}
              </div>
              <div className="progress-bar-container organize-progress-bar">
                <div
                  className="progress-bar-fill organize-progress-fill"
                  style={{ width: `${organizeProgress?.stage === 'moving' ? 90 : organizeProgress?.stage === 'remuxing' ? 65 : 20}%` }}
                />
              </div>
            </div>
          )}
          {organizeGame && !isOrganizing && (
            <div className="organize-preview">
              {(() => {
                const ext = media?.path ? media.path.split('.').pop().toLowerCase() : ''
                const willRemux = organizeRemux && ext !== 'mp4'
                return <>
                  Will be saved as: <strong>{organizeGame}</strong> Session &gt; Week folder
                  {willRemux ? ' › remuxed to MP4' : ext ? ` › ${ext.toUpperCase()} (move only)` : ' › MP4'}
                </>
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
