// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { sampleRecording, sampleAudioTracks } from '../fixtures/data.js'
import RecordingsPage from '../../src/viewer/pages/RecordingsPage.jsx'
import api from '../../src/api.js'

// MediaList uses canvas which jsdom doesn't support — replace with a simple DOM list
vi.mock('../../src/viewer/components/MediaList.jsx', () => ({
  default: ({ items, onSelect }) => (
    <ul>
      {items.map((item) => (
        <li key={item.path} onClick={() => onSelect(item)}>
          {item.filename}
        </li>
      ))}
    </ul>
  ),
}))

vi.mock('../../src/viewer/apiBase.js', () => ({
  apiFetch: (path, opts) => fetch(path, opts),
  apiPost: (path, data) =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  getBase: () => '',
  ready: Promise.resolve(),
}))

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// Suppress jsdom "not implemented" errors for video playback
beforeAll(() => {
  window.HTMLMediaElement.prototype.load = vi.fn()
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
  // ZoomTimeline uses ResizeObserver which is not in jsdom
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

function renderPage(initialPath = '/recordings') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/recordings" element={<RecordingsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RecordingsPage', () => {
  it('shows loading spinner initially', async () => {
    server.use(
      http.get('/api/recordings', async () => {
        await new Promise((r) => setTimeout(r, 100))
        return HttpResponse.json([])
      })
    )
    renderPage()
    expect(document.querySelector('.spinner')).toBeInTheDocument()
    // Drain the in-flight delayed fetch so all state updates complete within
    // this test and don't leak act() warnings into subsequent tests.
    await waitFor(() => expect(document.querySelector('.spinner')).not.toBeInTheDocument())
  })

  it('renders sidebar with recording list', async () => {
    server.use(
      http.get('/api/recordings', () => HttpResponse.json([sampleRecording])),
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] }))
    )
    renderPage()
    await waitFor(() => expect(screen.getByText(sampleRecording.filename)).toBeInTheDocument())
  })

  it('selects recording on sidebar click', async () => {
    server.use(
      http.get('/api/recordings', () => HttpResponse.json([sampleRecording])),
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] }))
    )
    renderPage()
    await waitFor(() => screen.getByText(sampleRecording.filename))
    fireEvent.click(screen.getByText(sampleRecording.filename))
    await waitFor(() => expect(document.querySelector('video')).toBeInTheDocument())
  })

  it('shows success toast when clip is created', async () => {
    server.use(
      http.get('/api/recordings', () => HttpResponse.json([sampleRecording])),
      // Use empty tracks to avoid waveform fetch requests that aren't relevant to this test
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] })),
      http.post('/api/clips/create', () =>
        HttpResponse.json({
          filename: 'Halo Clip 2025-01-15 #1.mp4',
          path: 'C:\\clips\\Halo Clip 2025-01-15 #1.mp4',
        })
      )
    )

    // Provide a non-zero duration so the ClipControls "Create Clip" button is enabled
    Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
      get: () => 60,
      configurable: true,
    })

    renderPage()

    // Select the recording so VideoPlayer renders
    await waitFor(() => screen.getByText(sampleRecording.filename))
    fireEvent.click(screen.getByText(sampleRecording.filename))
    await waitFor(() => expect(document.querySelector('video')).toBeInTheDocument())
    const video = document.querySelector('video')

    // Trigger loadedmetadata so VideoPlayer sets its duration state to 60
    await act(async () => {
      fireEvent.loadedMetadata(video)
    })

    // Enter clip mode by clicking the "Create Clip" action button
    await waitFor(() => screen.getByTestId('enter-clip-btn'))
    fireEvent.click(screen.getByTestId('enter-clip-btn'))

    // Now ClipControls is shown – click its "Create Clip" button to submit the clip
    await waitFor(() => screen.getByText(/Cancel/i))
    const clipBtns = screen.getAllByRole('button', { name: /Create Clip/i })
    const clipCreateBtn = clipBtns[clipBtns.length - 1] // The second button is the clip creation button
    await act(async () => {
      fireEvent.click(clipCreateBtn)
    })

    // Verify the success toast appears with the clip filename
    await waitFor(() =>
      expect(screen.getByText(/Clip created: Halo Clip 2025-01-15 #1\.mp4/i)).toBeInTheDocument()
    )
  })

  it('auto-selects recording from ?path= URL param', async () => {
    server.use(
      http.get('/api/recordings', () => HttpResponse.json([sampleRecording])),
      http.get('/api/video/tracks', () => HttpResponse.json({ tracks: [] })),
      http.get('/api/markers', () => HttpResponse.json({ markers: [] }))
    )
    renderPage(`/recordings?path=${encodeURIComponent(sampleRecording.path)}`)
    await waitFor(() => document.querySelector('video'))
    // Flush VideoPlayer's async track fetch so it completes while MSW handlers
    // are still registered, preventing afterEach teardown warnings.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  })

  // ── session-progress behaviour (banner now rendered globally in App, not here) ──

  it('refreshes recording list when a complete event fires', async () => {
    let fetchCount = 0
    server.use(
      http.get('/api/recordings', () => {
        fetchCount++
        return HttpResponse.json([])
      })
    )

    let capturedProgressCb
    vi.spyOn(api, 'onSessionProgress').mockImplementation((cb) => {
      capturedProgressCb = cb
      return () => {}
    })

    renderPage()
    await waitFor(() => expect(document.querySelector('.spinner')).not.toBeInTheDocument())
    const fetchCountAfterMount = fetchCount

    await act(async () => {
      capturedProgressCb?.({ phase: 'complete', gameName: 'Halo' })
    })

    await waitFor(() => expect(fetchCount).toBeGreaterThan(fetchCountAfterMount))

    vi.restoreAllMocks()
  })

  it('does not render a session-progress-banner element (banner lives in App)', async () => {
    server.use(http.get('/api/recordings', () => HttpResponse.json([])))

    let capturedProgressCb
    vi.spyOn(api, 'onSessionProgress').mockImplementation((cb) => {
      capturedProgressCb = cb
      return () => {}
    })

    renderPage()
    await waitFor(() => expect(document.querySelector('.spinner')).not.toBeInTheDocument())

    await act(async () => {
      capturedProgressCb?.({
        phase: 'recording',
        stage: 'remuxing',
        label: 'Remuxing to MP4…',
        gameName: 'Halo',
      })
    })

    // The banner is now in AppLayout, not RecordingsPage — should never appear here
    expect(document.querySelector('.session-progress-banner')).not.toBeInTheDocument()

    vi.restoreAllMocks()
  })
})
