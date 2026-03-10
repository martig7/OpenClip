// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { sampleRecording, sampleAudioTracks } from '../fixtures/data.js'
import VideoPlayer from '../../src/viewer/components/VideoPlayer.jsx'

vi.mock('../../src/viewer/apiBase.js', () => ({
  apiFetch: (path, opts) => fetch(path, opts),
  apiPost: (path, data) => fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }),
  getBase: () => '',
  ready: Promise.resolve(),
}))

const server = setupServer()

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' })
  window.HTMLMediaElement.prototype.load = vi.fn()
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
  // jsdom doesn't implement ResizeObserver — add a no-op polyfill
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // jsdom canvas.getContext('2d') returns null — provide a stub so AudioWaveformTrack doesn't crash
  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
  })
})

afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})

afterAll(() => server.close())

function renderPlayer(recording = null, onClipCreated = vi.fn()) {
  return render(<VideoPlayer recording={recording} onClipCreated={onClipCreated} />)
}

describe('VideoPlayer', () => {
  it('shows placeholder when no recording prop', () => {
    renderPlayer(null)
    expect(screen.getByText(/Select a recording/i)).toBeInTheDocument()
  })

  it('renders video element when recording is provided', async () => {
    server.use(
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
    )
    renderPlayer(sampleRecording)
    await waitFor(() => expect(document.querySelector('video')).toBeInTheDocument())
  })

  it('video src includes encoded recording path', async () => {
    server.use(
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
    )
    renderPlayer(sampleRecording)
    await waitFor(() => document.querySelector('video'))
    const video = document.querySelector('video')
    expect(video.src).toContain(encodeURIComponent(sampleRecording.path))
  })

  it('shows clip mode controls when Create Clip is clicked', async () => {
    server.use(
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
    )
    renderPlayer(sampleRecording)
    await waitFor(() => screen.getByText(/Create Clip/i))
    fireEvent.click(screen.getByText(/Create Clip/i))
    await waitFor(() => expect(screen.getByText(/Cancel/i)).toBeInTheDocument())
  })

  it('hides clip controls when Cancel is clicked', async () => {
    server.use(
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
    )
    renderPlayer(sampleRecording)
    await waitFor(() => screen.getByText(/Create Clip/i))
    fireEvent.click(screen.getByText(/Create Clip/i))
    await waitFor(() => screen.getByText(/Cancel/i))
    fireEvent.click(screen.getByText(/Cancel/i))
    await waitFor(() => expect(screen.queryByText(/Cancel/i)).not.toBeInTheDocument())
  })

  it('shows audio track list when tracks are returned', async () => {
    server.use(
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: sampleAudioTracks })),
      http.get('/api/video/waveform', () => HttpResponse.json({ peaks: [], duration: 60 })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
    )
    renderPlayer(sampleRecording)
    // Audio tracks are inside ZoomTimeline which only renders in clip mode
    await waitFor(() => screen.getByText(/Create Clip/i))
    fireEvent.click(screen.getByText(/Create Clip/i))
    await waitFor(() => expect(screen.getByText('Game Audio')).toBeInTheDocument())
    expect(screen.getByText('Discord')).toBeInTheDocument()
  })

  it('resets state when recording prop changes', async () => {
    server.use(
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
    )
    const { rerender } = renderPlayer(sampleRecording)
    await waitFor(() => document.querySelector('video'))

    const recording2 = { ...sampleRecording, path: sampleRecording.path + '2', filename: 'new.mp4' }
    rerender(<VideoPlayer recording={recording2} onClipCreated={vi.fn()} />)

    await waitFor(() => {
      const video = document.querySelector('video')
      expect(video?.src).toContain(encodeURIComponent(recording2.path))
    })
  })

  it('calls onClipCreated callback after successful clip creation', async () => {
    const onClipCreated = vi.fn()
    const clipResult = { filename: 'Halo Clip 2025-01-15 #1.mp4', path: '/clips/halo.mp4' }

    server.use(
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: sampleAudioTracks })),
      http.get('/api/video/waveform', () => HttpResponse.json({ peaks: [0.5], duration: 60 })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
      http.post('/api/clips/create', () => HttpResponse.json(clipResult)),
    )
    renderPlayer(sampleRecording, onClipCreated)
    await waitFor(() => document.querySelector('video'))

    // Simulate video metadata so duration > 0 (jsdom never fires loadedmetadata automatically)
    const video = document.querySelector('video')
    Object.defineProperty(video, 'duration', { get: () => 60, configurable: true })
    fireEvent(video, new Event('loadedmetadata'))

    await waitFor(() => screen.getByText(/Create Clip/i))
    fireEvent.click(screen.getByText(/Create Clip/i))

    // Wait for clip controls to appear (Cancel button is unique to clip mode)
    await waitFor(() => screen.getByText(/Cancel/i))

    // The Create Clip button inside ClipControls should now be enabled (clipDuration > 0)
    const clipCreateBtn = document.querySelector('.clip-controls button.btn-primary')
    expect(clipCreateBtn).not.toBeNull()
    fireEvent.click(clipCreateBtn)
    await waitFor(() => expect(onClipCreated).toHaveBeenCalledWith(clipResult))
  })
})
