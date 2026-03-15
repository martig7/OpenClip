// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { sampleRecording, sampleAudioTracks } from '../fixtures/data.js'
import VideoPlayer from '../../src/viewer/components/VideoPlayer.jsx'
import api from '../../src/api.js'

// Fixture: an unorganized recording (game_name === '(Unorganized)')
const unorganizedRecording = {
  path: 'C:\\Users\\Test\\OBS\\2026-03-11 14-48-25.mkv',
  filename: '2026-03-11 14-48-25.mkv',
  game_name: '(Unorganized)',
  date: '2026-03-11',
  size_bytes: 1_073_741_824,
  size_formatted: '1.0 GB',
  mtime: 1741700000,
}

const sampleGames = [
  { id: '1', name: 'Minecraft', enabled: true },
  { id: '2', name: 'Overwatch', enabled: true },
]

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

  it('seeking to position updates current time', async () => {
    server.use(
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
    )
    renderPlayer(sampleRecording)
    await waitFor(() => document.querySelector('video'))

    const video = document.querySelector('video')
    Object.defineProperty(video, 'currentTime', { get: () => 0, set: vi.fn(), configurable: true })
    Object.defineProperty(video, 'duration', { get: () => 60, configurable: true })
    fireEvent(video, new Event('loadedmetadata'))

    // Simulate a seek (click on timeline at 50% position)
    fireEvent.timeUpdate(video)
    Object.defineProperty(video, 'currentTime', { get: () => 30, configurable: true })
    fireEvent.timeUpdate(video)

    expect(video.currentTime).toBe(30)
  })
})

// ─────────────────────────────────────────────────────────────────
// Organize panel
// ─────────────────────────────────────────────────────────────────
describe('VideoPlayer — organize panel', () => {
  function setupHandlers() {
    server.use(
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
    )
  }

  it('shows Unorganized badge for an unorganized recording', async () => {
    setupHandlers()
    render(<VideoPlayer recording={unorganizedRecording} games={sampleGames} />)
    // Badge text is exactly 'Unorganized'; game_name in meta is '(Unorganized)'
    await waitFor(() => expect(screen.getByText('Unorganized')).toBeInTheDocument())
  })

  it('shows Organize button instead of Create Clip for unorganized recordings', async () => {
    setupHandlers()
    render(<VideoPlayer recording={unorganizedRecording} games={sampleGames} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Organize$/i })).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /Create Clip/i })).not.toBeInTheDocument()
  })

  it('opens organize panel when Organize button is clicked', async () => {
    setupHandlers()
    render(<VideoPlayer recording={unorganizedRecording} games={sampleGames} />)
    await waitFor(() => screen.getByRole('button', { name: /^Organize$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Organize$/i }))
    await waitFor(() => expect(screen.getByText(/Move to organized library/i)).toBeInTheDocument())
    expect(screen.getByText('Minecraft')).toBeInTheDocument()
    expect(screen.getByText('Overwatch')).toBeInTheDocument()
  })

  it('preview shows "remuxed to MP4" when organizeRemux=true and file is non-mp4', async () => {
    setupHandlers()
    render(
      <VideoPlayer
        recording={unorganizedRecording}
        games={sampleGames}
        organizeRemux={true}
      />
    )
    await waitFor(() => screen.getByRole('button', { name: /^Organize$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Organize$/i }))
    await waitFor(() => screen.getByText(/Move to organized library/i))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Minecraft' } })

    await waitFor(() =>
      expect(screen.getByText(/remuxed to MP4/i)).toBeInTheDocument()
    )
  })

  it('preview shows "move only" when organizeRemux=false and file is non-mp4', async () => {
    setupHandlers()
    render(
      <VideoPlayer
        recording={unorganizedRecording}
        games={sampleGames}
        organizeRemux={false}
      />
    )
    await waitFor(() => screen.getByRole('button', { name: /^Organize$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Organize$/i }))
    await waitFor(() => screen.getByText(/Move to organized library/i))

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Minecraft' } })

    await waitFor(() =>
      expect(screen.getByText(/move only/i)).toBeInTheDocument()
    )
  })

  it('shows progress bar with "Starting…" label immediately when organizing begins', async () => {
    setupHandlers()

    // organizeRecording resolves only when we let it — so we can assert mid-flight
    let resolveOrganize
    vi.spyOn(api, 'organizeRecording').mockImplementation(
      () => new Promise(resolve => { resolveOrganize = resolve })
    )

    render(
      <VideoPlayer
        recording={unorganizedRecording}
        games={sampleGames}
        onOrganized={vi.fn()}
        onOrganizeError={vi.fn()}
      />
    )

    await waitFor(() => screen.getByRole('button', { name: /^Organize$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Organize$/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Minecraft' } })

    // There are now two "Organize" buttons (toggle + panel submit); click the one in the panel row
    const [, panelOrganizeBtn] = screen.getAllByRole('button', { name: /^Organize$/i })
    fireEvent.click(panelOrganizeBtn)

    await waitFor(() =>
      expect(screen.getByText(/Starting…/i)).toBeInTheDocument()
    )

    // Clean up the pending promise
    resolveOrganize({ success: true, filename: 'Minecraft Session 2026-03-11 #1.mkv' })
    vi.restoreAllMocks()
  })

  it('progress label updates when onOrganizeProgress fires a stage event', async () => {
    setupHandlers()

    let resolveOrganize
    let capturedProgressCallback

    // Both spies must be registered before render so mount-time useEffect captures them
    vi.spyOn(api, 'onOrganizeProgress').mockImplementation(cb => {
      capturedProgressCallback = cb
      return () => {}
    })
    vi.spyOn(api, 'organizeRecording').mockImplementation(
      () => new Promise(resolve => { resolveOrganize = resolve })
    )

    render(
      <VideoPlayer
        recording={unorganizedRecording}
        games={sampleGames}
        onOrganized={vi.fn()}
        onOrganizeError={vi.fn()}
      />
    )

    await waitFor(() => screen.getByRole('button', { name: /^Organize$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Organize$/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Minecraft' } })

    const [, panelSubmitBtn] = screen.getAllByRole('button', { name: /^Organize$/i })
    fireEvent.click(panelSubmitBtn)

    // Simulate backend emitting a progress stage event
    await act(async () => {
      capturedProgressCallback?.({ stage: 'remuxing', label: 'Remuxing to MP4…' })
    })

    await waitFor(() =>
      expect(screen.getByText(/Remuxing to MP4/i)).toBeInTheDocument()
    )

    resolveOrganize({ success: true, filename: 'Minecraft Session 2026-03-11 #1.mkv' })
    vi.restoreAllMocks()
  })

  it('progress bar disappears and onOrganized fires after successful organize', async () => {
    setupHandlers()

    const onOrganized = vi.fn()
    vi.spyOn(api, 'organizeRecording').mockResolvedValue({
      success: true,
      filename: 'Minecraft Session 2026-03-11 #1.mkv',
      path: 'D:\\Videos\\Minecraft Session 2026-03-11 #1.mkv',
    })

    render(
      <VideoPlayer
        recording={unorganizedRecording}
        games={sampleGames}
        onOrganized={onOrganized}
        onOrganizeError={vi.fn()}
      />
    )

    await waitFor(() => screen.getByText(/^Organize$/i))
    fireEvent.click(screen.getByRole('button', { name: /^Organize$/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Minecraft' } })

    const [, panelOrganizeBtn] = screen.getAllByRole('button', { name: /^Organize$/i })
    fireEvent.click(panelOrganizeBtn)

    await waitFor(() => expect(onOrganized).toHaveBeenCalled())
    // Progress bar must be gone
    expect(screen.queryByText(/Starting…/i)).not.toBeInTheDocument()
    vi.restoreAllMocks()
  })
})
