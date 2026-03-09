import { useRef, useState, useEffect, useCallback } from 'react'
import Timeline from './Timeline'
import ClipControls from './ClipControls'
import ZoomTimeline from './ZoomTimeline'
import { apiFetch, getBase } from '../apiBase'

function VideoPlayer({ recording, onClipCreated }) {
  const videoRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)

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

  // Reset state when recording changes
  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setClipMode(false)
    setMarkers([])
    setAudioTracks([])
    setSelectedTracks([])
    setWaveforms({})
  }, [recording])

  // Fetch audio tracks when recording changes
  useEffect(() => {
    if (!recording) return

    const fetchTracks = async () => {
      try {
        const response = await apiFetch(
          `/api/video/tracks?path=${encodeURIComponent(recording.path)}`
        )
        const data = await response.json()
        if (response.ok && data.tracks) {
          setAudioTracks(data.tracks)
          setSelectedTracks(data.tracks.map((_, i) => i))
          // Fetch waveform for each track
          data.tracks.forEach(async (_, i) => {
            try {
              const waveRes = await apiFetch(
                `/api/video/waveform?path=${encodeURIComponent(recording.path)}&track=${i}`
              )
              const waveData = await waveRes.json()
              if (waveRes.ok && waveData.peaks?.length) {
                setWaveforms(prev => ({ ...prev, [i]: waveData.peaks }))
              }
            } catch {}
          })
        }
      } catch (error) {
        console.error('Failed to fetch audio tracks:', error)
      }
    }

    fetchTracks()
  }, [recording])

  // Sync HTMLVideoElement audio track enabled state with selectedTracks in clip mode
  useEffect(() => {
    const video = videoRef.current
    if (!video?.audioTracks?.length) return
    for (let i = 0; i < video.audioTracks.length; i++) {
      video.audioTracks[i].enabled = !clipMode || selectedTracks.includes(i)
    }
  }, [selectedTracks, clipMode])

  // Fetch markers when recording changes and duration is known
  useEffect(() => {
    if (!recording || !duration) return

    const fetchMarkers = async () => {
      try {
        const response = await apiFetch(
          `/api/markers?path=${encodeURIComponent(recording.path)}&game_name=${encodeURIComponent(recording.game_name)}`
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
  }, [recording, duration])

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

  const handleMarkerClick = useCallback((position) => {
    handleSeek(position)
    if (videoRef.current && !isPlaying) {
      videoRef.current.play()
    }
  }, [handleSeek, isPlaying])

  const enterClipMode = useCallback(() => {
    setClipMode(true)
    setClipStart(currentTime)
    setClipEnd(Math.min(currentTime + 30, duration))
  }, [currentTime, duration])

  const exitClipMode = useCallback(() => {
    setClipMode(false)
  }, [])

  const toggleTrack = useCallback((index) => {
    setSelectedTracks(prev => {
      if (prev.includes(index)) {
        if (prev.length <= 1) return prev
        return prev.filter(i => i !== index)
      }
      return [...prev, index].sort((a, b) => a - b)
    })
  }, [])

  const handleCreateClip = useCallback(async () => {
    if (!recording || isCreatingClip) return

    setIsCreatingClip(true)
    try {
      const response = await apiFetch('/api/clips/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_path: recording.path,
          start_time: clipStart,
          end_time: clipEnd,
          game_name: recording.game_name,
          audio_tracks: audioTracks.length > 1 && selectedTracks.length < audioTracks.length
            ? selectedTracks : null
        })
      })

      const data = await response.json()

      if (response.ok) {
        setClipMode(false)
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

  const formatTime = (seconds) => {
    if (!isFinite(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (!recording) {
    return (
      <div className="main-content">
        <div className="player-container">
          <div className="player-placeholder">
            <div className="icon">&#127916;</div>
            <p>Select a recording to play</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="main-content">
      <div className="player-container">
        <video
          ref={videoRef}
          src={`${getBase()}/api/video?path=${encodeURIComponent(recording.path)}`}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={handlePlay}
          onPause={handlePause}
          onClick={togglePlay}
        />
      </div>

      <div className="video-controls">
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
        />

        <div className="controls-row">
          <button className="control-btn" onClick={() => skip(-10)} title="Rewind 10s">
            &#9194;
          </button>
          <button className="control-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? '\u23F8' : '\u25B6'}
          </button>
          <button className="control-btn" onClick={() => skip(10)} title="Forward 10s">
            &#9193;
          </button>

          <span className="time-display">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="volume-control">
            <button className="control-btn" onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted ? '\u{1F507}' : '\u{1F50A}'}
            </button>
            <input
              type="range"
              className="volume-slider"
              min="0"
              max="1"
              step="0.1"
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            />
          </div>
        </div>

        {clipMode && (
          <>
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
          </>
        )}
      </div>

      <div className="video-info-bar">
        <h2 className="video-title">{recording.filename}</h2>
        <div className="video-meta">
          <span>&#128193; {recording.game_name}</span>
          <span>&#128197; {recording.date}</span>
          <span>&#128190; {recording.size_formatted}</span>
        </div>
        <div className="action-buttons">
          {!clipMode && (
            <button className="btn btn-primary" onClick={enterClipMode}>
              &#9986; Create Clip
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => apiFetch('/api/open-external', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: recording.path })
            })}
          >
            &#9654; Open in Player
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => apiFetch('/api/show-in-explorer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: recording.path })
            })}
          >
            &#128194; Show in Explorer
          </button>
        </div>
      </div>
    </div>
  )
}

export default VideoPlayer
