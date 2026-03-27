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
import MainContentTopBar from './MainContentTopBar'
import { apiFetch, apiPost, getBase } from '../apiBase'
import { formatTime } from '../formatTime'
import api from '../../api'
import { useOrganizeProgress } from '../../App'


const WAVEFORM_CHUNK_SIZE = 30
const WAVEFORM_MAX_INFLIGHT = 3

function buildChunkQueue(numChunks, viewportIdx) {
  const queue = []
  const seen = new Set()
  const add = (i) => { if (i >= 0 && i < numChunks && !seen.has(i)) { queue.push(i); seen.add(i) } }
  add(viewportIdx)
  for (let delta = 1; delta < numChunks; delta++) { add(viewportIdx - delta); add(viewportIdx + delta) }
  return queue
}

// Reorder pending (not yet in-flight) chunks in `queue` around a new priority center.
// Mutates the queue array in place so the draining fetchNext loop picks up the new order.
function reprioritizeQueue(queue, numChunks, newViewportIdx) {
  const remaining = new Set(queue)
  const newQueue = []
  const seen = new Set()
  const add = (i) => {
    if (i >= 0 && i < numChunks && remaining.has(i) && !seen.has(i)) { newQueue.push(i); seen.add(i) }
  }
  add(newViewportIdx)
  for (let delta = 1; delta < numChunks; delta++) { add(newViewportIdx - delta); add(newViewportIdx + delta) }
  queue.splice(0, queue.length, ...newQueue)
}

function VideoPlayer({
  recording,
  clip,
  onClipCreated,
  onTrimmed,
  onDelete,
  games = [],
  onOrganized,
  onOrganizeError,
  organizeRemux = true,
  persistedShareState = null,
  onShareStateChange,
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
  const [isTrimMode, setIsTrimMode] = useState(false)
  const [clipStart, setClipStart] = useState(0)
  const [clipEnd, setClipEnd] = useState(30)
  const [isCreatingClip, setIsCreatingClip] = useState(false)
  const [isTrimming, setIsTrimming] = useState(false)
  const [suppressVideoSrc, setSuppressVideoSrc] = useState(false)
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

  // Chunked waveform delivery refs
  const waveformRawPeaksRef = useRef(new Map())
  const waveformGlobalMaxRef = useRef(new Map())
  const waveformChunksDoneRef = useRef(new Set())
  const waveformQueueRef = useRef(null)
  const waveformNumChunksRef = useRef(0)
  const viewportChunkRef = useRef(null)
  const pauseWaveformFetchRef = useRef(false)
  const resumeWaveformTimerRef = useRef(null)

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
    setIsTrimMode(false)
    setIsTrimming(false)
    setSuppressVideoSrc(false)
    setIsZoomTimelineExpanded(false)
    setMarkers([])
    setAudioTracks([])
    setSelectedTracks([])
    setWaveforms({})
    setOrganizeMode(false)
    setOrganizeGame('')
    waveformCacheRef.current.clear()
    waveformRawPeaksRef.current.clear()
    waveformGlobalMaxRef.current.clear()
    waveformChunksDoneRef.current = new Set()
    waveformQueueRef.current = null
    waveformNumChunksRef.current = 0
    viewportChunkRef.current = null
    pauseWaveformFetchRef.current = false
    if (resumeWaveformTimerRef.current) {
      clearTimeout(resumeWaveformTimerRef.current)
      resumeWaveformTimerRef.current = null
    }
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

          // Fetch waveforms — check cache then handle hit/miss/no-audio
          const tracksToChunk = []
          await Promise.all(data.tracks.map(async (_track, trackIndex) => {
            if (cancelled) return

            const cacheKey = `${media.path}:${trackIndex}:${waveformResolution}`
            const cached = waveformCacheRef.current.get(cacheKey)
            if (cached) {
              setWaveforms((prev) => ({ ...prev, [trackIndex]: cached.peaks }))
              return
            }

            try {
              const waveRes = await apiFetch(
                `/api/video/waveform?path=${encodeURIComponent(media.path)}&track=${trackIndex}&resolution=${waveformResolution}`,
                { signal: abortController.signal }
              )
              if (cancelled) return
              const waveData = await waveRes.json()
              if (cancelled) return

              if (waveRes.ok && waveData.peaks?.length) {
                waveformCacheRef.current.set(cacheKey, { peaks: waveData.peaks })
                setWaveforms((prev) => ({ ...prev, [trackIndex]: waveData.peaks }))
              } else if (waveRes.ok && waveData.status === 'miss') {
                tracksToChunk.push({ trackIndex, fileDuration: waveData.duration })
              }
              // else: peaks: [] (no audio) — leave waveform empty
            } catch (e) {
              if (e.name !== 'AbortError') {
                console.error(`Failed to fetch waveform for track ${trackIndex}:`, e)
              }
            }
          }))

          if (cancelled || !tracksToChunk.length) return

          // Chunked delivery — one unified queue, all tracks fetched per chunk
          const fileDuration = tracksToChunk[0].fileDuration
          const numChunks = Math.ceil(fileDuration / WAVEFORM_CHUNK_SIZE)
          const viewportIdx = viewportChunkRef.current ?? 0
          const queue = buildChunkQueue(numChunks, viewportIdx)
          waveformQueueRef.current = queue
          waveformNumChunksRef.current = numChunks
          const globalDone = new Set()
          waveformChunksDoneRef.current = globalDone

          for (const { trackIndex } of tracksToChunk) {
            waveformRawPeaksRef.current.set(trackIndex, null)
            waveformGlobalMaxRef.current.set(trackIndex, 0)
          }

          await new Promise((resolve) => {
            let inFlight = 0

            function fetchNext() {
              if (pauseWaveformFetchRef.current) {
                setTimeout(fetchNext, 150)
                return
              }
              while (inFlight < WAVEFORM_MAX_INFLIGHT && queue.length > 0) {
                const chunkIdx = queue.shift()
                inFlight++
                const startTime = chunkIdx * WAVEFORM_CHUNK_SIZE
                const endTime = Math.min(startTime + WAVEFORM_CHUNK_SIZE, fileDuration)

                // Fetch all tracks for this chunk in parallel
                Promise.all(
                  tracksToChunk.map(({ trackIndex }) =>
                    apiFetch(
                      `/api/video/waveform/chunk?path=${encodeURIComponent(media.path)}&track=${trackIndex}&start=${startTime}&end=${endTime}&totalDuration=${fileDuration}&resolution=${waveformResolution}`,
                      { signal: abortController.signal }
                    )
                      .then((r) => r.json())
                      .then((data) => ({ trackIndex, data }))
                      .catch((e) => ({ trackIndex, data: null, error: e }))
                  )
                ).then((results) => {
                  globalDone.add(chunkIdx)
                  if (!cancelled) {
                    const waveformsUpdate = {}
                    for (const { trackIndex, data, error } of results) {
                      if (error) {
                        if (error.name !== 'AbortError') {
                          console.error(`Waveform chunk error (track ${trackIndex}, chunk ${chunkIdx}):`, error)
                        }
                        continue
                      }
                      if (!data?.peaks?.length) continue

                      const numPeaksTotal = data.numPeaksTotal
                      if (!waveformRawPeaksRef.current.get(trackIndex)) {
                        waveformRawPeaksRef.current.set(trackIndex, new Float32Array(numPeaksTotal))
                      }
                      const rawPeaks = waveformRawPeaksRef.current.get(trackIndex)

                      const startIdx = Math.round((startTime / fileDuration) * numPeaksTotal)
                      const endIdx = Math.min(
                        Math.round((endTime / fileDuration) * numPeaksTotal),
                        numPeaksTotal
                      )
                      const chunkPeaks = data.peaks.slice(0, endIdx - startIdx)
                      rawPeaks.set(chunkPeaks, startIdx)

                      let globalMax = waveformGlobalMaxRef.current.get(trackIndex)
                      const chunkMax = Math.max(...chunkPeaks)
                      if (chunkMax > globalMax) globalMax = chunkMax
                      globalMax = Math.max(globalMax, 0.001)
                      waveformGlobalMaxRef.current.set(trackIndex, globalMax)

                      waveformsUpdate[trackIndex] = Array.from(rawPeaks, (v) => v / globalMax)
                    }
                    if (Object.keys(waveformsUpdate).length > 0) {
                      setWaveforms((prev) => ({ ...prev, ...waveformsUpdate }))
                    }
                  }
                  inFlight--
                  if (queue.length === 0 && inFlight === 0) resolve()
                  else setTimeout(fetchNext, 0)
                })
              }

              if (inFlight === 0 && queue.length === 0) resolve()
            }

            fetchNext()
          })

          if (cancelled) return

          // Background cache population — fire sequentially to avoid concurrent full-file FFmpeg processes
          for (const { trackIndex } of tracksToChunk) {
            if (cancelled) break
            try {
              await apiPost('/api/video/waveform/cache', {
                path: media.path,
                track: trackIndex,
                resolution: waveformResolution,
              })
            } catch {
              // best-effort
            }
          }
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
      const t = videoRef.current.currentTime
      setCurrentTime(t)
      // Reprioritize chunk queue when playback crosses into a new chunk
      const chunkIdx = Math.floor(t / WAVEFORM_CHUNK_SIZE)
      if (chunkIdx !== viewportChunkRef.current && waveformQueueRef.current) {
        viewportChunkRef.current = chunkIdx
        reprioritizeQueue(waveformQueueRef.current, waveformNumChunksRef.current, chunkIdx)
      }
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

  const deprioritizeWaveforms = useCallback((delayMs = 900) => {
    pauseWaveformFetchRef.current = true
    if (resumeWaveformTimerRef.current) clearTimeout(resumeWaveformTimerRef.current)
    resumeWaveformTimerRef.current = setTimeout(() => {
      pauseWaveformFetchRef.current = false
      resumeWaveformTimerRef.current = null
    }, delayMs)
  }, [])

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
      deprioritizeWaveforms(1300)
      videoRef.current.currentTime = time
      setCurrentTime(time)
      // Reprioritize chunk queue based on seek target
      const chunkIdx = Math.floor(time / WAVEFORM_CHUNK_SIZE)
      if (chunkIdx !== viewportChunkRef.current && waveformQueueRef.current) {
        viewportChunkRef.current = chunkIdx
        reprioritizeQueue(waveformQueueRef.current, waveformNumChunksRef.current, chunkIdx)
      }
    }
  }, [deprioritizeWaveforms])

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
    return () => {
      if (resumeWaveformTimerRef.current) clearTimeout(resumeWaveformTimerRef.current)
    }
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
    setIsTrimMode(false)
    // Reset track selection so all tracks play when not in clip mode
    setSelectedTracks(audioTracks.map((_, i) => i))
  }, [audioTracks])

  const enterTrimMode = useCallback(() => {
    setIsTrimMode(true)
    setClipMode(true)
    setIsZoomTimelineExpanded(false)
    setClipStart(0)
    setClipEnd(duration)
    setTimeout(() => {
      if (zoomTimelineRef.current) {
        zoomTimelineRef.current.zoomFit()
      }
    }, 50)
  }, [duration])

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

  const handleTrimClip = useCallback(async () => {
    if (!media || isTrimming) return

    setIsTrimming(true)
    // Release the file so the server closes its read stream before FFmpeg renames over it.
    // On Windows, an open read stream locks the file and causes EPERM on rename.
    setSuppressVideoSrc(true)
    await new Promise((r) => setTimeout(r, 150))

    try {
      const response = await apiPost('/api/clips/trim', {
        source_path: media.path,
        start_time: clipStart,
        end_time: clipEnd,
        game_name: media.game_name,
      })

      const data = await response.json()

      if (response.ok) {
        setClipMode(false)
        setIsTrimMode(false)
        if (onTrimmed) {
          onTrimmed(data)
        }
      } else {
        setSuppressVideoSrc(false)
        alert(`Failed to trim clip: ${data.error}`)
      }
    } catch (error) {
      setSuppressVideoSrc(false)
      alert(`Error trimming clip: ${error.message}`)
    } finally {
      setIsTrimming(false)
    }
  }, [media, clipStart, clipEnd, isTrimming, onTrimmed])

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

  // Share state: { phase: 'compressing'|'uploading'|'done'|'error', url, error, percent } or null
  const [shareModal, setShareModal] = useState(persistedShareState)
  const [shareCopied, setShareCopied] = useState(false)
  const isSharing = shareModal?.phase === 'uploading' || shareModal?.phase === 'compressing'

  // Restore persisted share state when the clip changes or when the store finishes loading.
  // Guard: never overwrite an active share in progress.
  useEffect(() => {
    setShareModal((current) => {
      if (current?.phase === 'compressing' || current?.phase === 'uploading') return current
      return persistedShareState ?? null
    })
    if (!persistedShareState) setShareCopied(false)
  }, [media?.path, persistedShareState])

  // Listen for compression/upload progress events
  useEffect(() => {
    if (!api.onShareProgress) return
    const unsub = api.onShareProgress((data) => {
      setShareModal((prev) => {
        if (!prev || prev.phase === 'done' || prev.phase === 'error') return prev
        const next = { ...prev, phase: data.phase, percent: data.percent }
        onShareStateChange?.(media?.path, next)
        return next
      })
    })
    return () => unsub()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media?.path])

  const handleShare = useCallback(async () => {
    if (isSharing) return
    const initial = { phase: 'compressing', percent: 0, url: null, error: null }
    setShareModal(initial)
    onShareStateChange?.(media?.path, initial)
    setShareCopied(false)
    try {
      const result = await api.shareClip(media.path)
      if (result?.success && result.url) {
        const done = { phase: 'done', url: result.url, error: null }
        setShareModal(done)
        onShareStateChange?.(media?.path, done)
      } else {
        const err = { phase: 'error', url: null, error: result?.error || 'Upload failed' }
        setShareModal(err)
        onShareStateChange?.(media?.path, err)
      }
    } catch (err) {
      const errState = { phase: 'error', url: null, error: err.message || 'Upload failed' }
      setShareModal(errState)
      onShareStateChange?.(media?.path, errState)
    }
  }, [isSharing, media, onShareStateChange])

  const handleShareCopy = useCallback(async () => {
    if (!shareModal?.url) return
    try {
      await navigator.clipboard.writeText(shareModal.url)
    } catch {
      // ignore
    }
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }, [shareModal])

  const handleShareRemove = useCallback(() => {
    setShareModal(null)
    setShareCopied(false)
    onShareStateChange?.(media?.path, null)
  }, [media, onShareStateChange])

  if (!media) {
    return (
      <div className="flex-1 flex flex-col bg-[var(--bg-primary)] w-full h-full overflow-hidden">
        <MainContentTopBar />
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
      <MainContentTopBar />
      <div
        className="player-container"
        onMouseEnter={handleVideoMouseEnter}
        onMouseLeave={handleVideoMouseLeave}
        onMouseMove={handleVideoMouseMove}
      >
        <video
          ref={videoRef}
          src={suppressVideoSrc ? undefined : `${getBase()}/api/video?path=${encodeURIComponent(media.path)}`}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeeking={() => deprioritizeWaveforms(1200)}
          onWaiting={() => deprioritizeWaveforms(1800)}
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
        isCreatingClip={isCreatingClip || isTrimming}
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
          enterTrimMode={isClip ? enterTrimMode : undefined}
          exitClipMode={exitClipMode}
          handleCreateClip={handleCreateClip}
          isCreatingClip={isCreatingClip}
          handleTrimClip={handleTrimClip}
          isTrimMode={isTrimMode}
          isTrimming={isTrimming}
          onDelete={onDelete}
          onShare={isClip ? handleShare : undefined}
          onShareRemove={isClip ? handleShareRemove : undefined}
          isSharing={isSharing}
          sharePhase={isClip ? (shareModal?.phase ?? null) : null}
          sharePercent={isClip ? (shareModal?.percent ?? null) : null}
          shareUrl={isClip ? (shareModal?.url ?? null) : null}
          shareError={isClip ? (shareModal?.error ?? null) : null}
          shareUrlCopied={shareCopied}
          onShareUrlCopy={handleShareCopy}
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
