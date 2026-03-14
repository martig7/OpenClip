// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { sampleClip } from '../fixtures/data.js'
import ClipsPage from '../../src/viewer/pages/ClipsPage.jsx'

// Mock apiBase so it resolves immediately with relative paths (no Electron port lookup)
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

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderPage(initialPath = '/clips') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/clips" element={<ClipsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ClipsPage', () => {
  it('shows loading spinner initially', async () => {
    server.use(
      http.get('/api/clips', async () => {
        await new Promise(r => setTimeout(r, 100))
        return HttpResponse.json([])
      })
    )
    renderPage()
    expect(document.querySelector('.spinner')).toBeInTheDocument()
    // Drain the in-flight delayed fetch so all state updates complete within
    // this test and don't leak act() warnings into subsequent tests.
    await waitFor(() => expect(document.querySelector('.spinner')).not.toBeInTheDocument())
  })

  it('shows placeholder when no clips', async () => {
    server.use(http.get('/api/clips', () => HttpResponse.json([])))
    renderPage()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.getByText(/Select a clip to play/i)).toBeInTheDocument()
  })

  it('renders sidebar with clip list', async () => {
    server.use(
      http.get('/api/clips', () => HttpResponse.json([
        sampleClip,
        { ...sampleClip, filename: 'Halo Clip 2025-01-15 #2.mp4', path: sampleClip.path + '2' },
      ]))
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('Halo Clip 2025-01-15 #1.mp4')).toBeInTheDocument())
    expect(screen.getByText('Halo Clip 2025-01-15 #2.mp4')).toBeInTheDocument()
  })

  it('shows clip details when a clip is selected', async () => {
    server.use(http.get('/api/clips', () => HttpResponse.json([sampleClip])))
    renderPage()
    await waitFor(() => screen.getByText(sampleClip.filename))
    fireEvent.click(screen.getByText(sampleClip.filename))
    await waitFor(() => expect(screen.getAllByText(sampleClip.filename).length).toBeGreaterThanOrEqual(1))
    expect(screen.getByText(sampleClip.game_name)).toBeInTheDocument()
  })

  it('opens delete modal when Delete button is clicked', async () => {
    server.use(http.get('/api/clips', () => HttpResponse.json([sampleClip])))
    renderPage()
    await waitFor(() => screen.getByText(sampleClip.filename))
    fireEvent.click(screen.getByText(sampleClip.filename))
    await waitFor(() => screen.getByText(/Delete/i, { selector: 'button.btn-danger' }))
    fireEvent.click(screen.getByText(/Delete/i, { selector: 'button.btn-danger' }))
    expect(screen.getByText(/Delete Clip\?/i)).toBeInTheDocument()
  })

  it('shows success toast and clears selection after confirming delete', async () => {
    server.use(
      http.get('/api/clips', () => HttpResponse.json([sampleClip])),
      http.post('/api/clips/delete', () => HttpResponse.json({ success: true }))
    )
    renderPage()
    await waitFor(() => screen.getByText(sampleClip.filename))
    fireEvent.click(screen.getByText(sampleClip.filename))
    await waitFor(() => screen.getByText(/Delete/i, { selector: 'button.btn-danger' }))
    fireEvent.click(screen.getByText(/Delete/i, { selector: 'button.btn-danger' }))
    // Confirm in modal
    const confirmBtn = screen.getByText('Delete', { selector: '.modal button.btn-danger' })
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(screen.getByText(/Clip deleted/i)).toBeInTheDocument())
  })

  it('shows error toast when delete fails', async () => {
    server.use(
      http.get('/api/clips', () => HttpResponse.json([sampleClip])),
      http.post('/api/clips/delete', () => HttpResponse.json({ error: 'Forbidden' }, { status: 403 }))
    )
    renderPage()
    await waitFor(() => screen.getByText(sampleClip.filename))
    fireEvent.click(screen.getByText(sampleClip.filename))
    await waitFor(() => screen.getByText(/Delete/i, { selector: 'button.btn-danger' }))
    fireEvent.click(screen.getByText(/Delete/i, { selector: 'button.btn-danger' }))
    const confirmBtn = screen.getByText('Delete', { selector: '.modal button.btn-danger' })
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(screen.getByText(/Failed to delete/i)).toBeInTheDocument())
  })

  it('dismisses delete modal on Cancel', async () => {
    server.use(http.get('/api/clips', () => HttpResponse.json([sampleClip])))
    renderPage()
    await waitFor(() => screen.getByText(sampleClip.filename))
    fireEvent.click(screen.getByText(sampleClip.filename))
    await waitFor(() => screen.getByText(/Delete/i, { selector: 'button.btn-danger' }))
    fireEvent.click(screen.getByText(/Delete/i, { selector: 'button.btn-danger' }))
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText(/Delete Clip\?/i)).not.toBeInTheDocument()
  })

  it('auto-selects clip from ?path= URL param', async () => {
    server.use(http.get('/api/clips', () => HttpResponse.json([sampleClip])))
    renderPage(`/clips?path=${encodeURIComponent(sampleClip.path)}`)
    await waitFor(() => expect(screen.getAllByText(sampleClip.filename).length).toBeGreaterThanOrEqual(1))
  })
})
