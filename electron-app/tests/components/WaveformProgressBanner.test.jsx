// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import '@testing-library/jest-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import WaveformProgressBanner from '../../src/viewer/components/WaveformProgressBanner.jsx'

const server = setupServer()

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' })
})

afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
})

afterAll(() => server.close())

describe('WaveformProgressBanner', () => {
  it('renders nothing when no generation state and status not complete', () => {
    render(<WaveformProgressBanner generation={null} status={null} audioTrackCount={0} />)
    expect(screen.queryByText(/Waiting in queue/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Generating waveforms/i)).not.toBeInTheDocument()
  })

  it('renders nothing when status is complete with audio tracks', () => {
    render(
      <WaveformProgressBanner
        generation={null}
        status={{ isComplete: true }}
        audioTrackCount={2}
      />
    )
    expect(screen.queryByText(/Waiting in queue/i)).not.toBeInTheDocument()
  })

  it('shows queued status with job ID', async () => {
    render(
      <WaveformProgressBanner
        generation={{
          jobId: 'wf_test_123',
          status: 'queued',
          progress: 0,
          resolution: 'medium',
        }}
        status={{}}
        audioTrackCount={2}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Waiting in queue/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Medium resolution/i)).toBeInTheDocument()
  })

  it('shows processing status with progress bar', async () => {
    render(
      <WaveformProgressBanner
        generation={{
          jobId: 'wf_test_123',
          status: 'processing',
          progress: 50,
          resolution: 'high',
        }}
        status={{}}
        audioTrackCount={2}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Generating waveforms/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/High resolution/i)).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('shows cancel button when queued', async () => {
    render(
      <WaveformProgressBanner
        generation={{
          jobId: 'wf_test_123',
          status: 'queued',
          progress: 0,
          resolution: 'medium',
        }}
        status={{}}
        audioTrackCount={2}
      />
    )

    const cancelBtn = await waitFor(() => screen.getByRole('button', { name: /Cancel/i }))
    expect(cancelBtn).toBeInTheDocument()
  })

  it('shows cancel button when processing', async () => {
    render(
      <WaveformProgressBanner
        generation={{
          jobId: 'wf_test_123',
          status: 'processing',
          progress: 30,
          resolution: 'low',
        }}
        status={{}}
        audioTrackCount={2}
      />
    )

    const cancelBtn = await waitFor(() => screen.getByRole('button', { name: /Cancel/i }))
    expect(cancelBtn).toBeInTheDocument()
  })

  it('does not show cancel button when complete', async () => {
    render(
      <WaveformProgressBanner
        generation={{
          jobId: 'wf_test_123',
          status: 'complete',
          progress: 100,
          resolution: 'medium',
        }}
        status={{ isComplete: true }}
        audioTrackCount={2}
      />
    )

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument()
    })
  })

  it('does not show cancel button when error', async () => {
    render(
      <WaveformProgressBanner
        generation={{
          jobId: 'wf_test_123',
          status: 'error',
          progress: 0,
          resolution: 'medium',
        }}
        status={{}}
        audioTrackCount={2}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Generation failed/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument()
  })

  it('calls cancel API when cancel button is clicked', async () => {
    const cancelSpy = vi.fn()
    server.use(
      http.post('/api/waveform/cancel', ({ request }) => {
        cancelSpy(request.url)
        return HttpResponse.json({ success: true })
      })
    )

    render(
      <WaveformProgressBanner
        generation={{
          jobId: 'wf_test_123',
          status: 'processing',
          progress: 30,
          resolution: 'medium',
        }}
        status={{}}
        audioTrackCount={2}
      />
    )

    const cancelBtn = await waitFor(() => screen.getByRole('button', { name: /Cancel/i }))
    fireEvent.click(cancelBtn)

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/waveform/cancel?jobId=wf_test_123')
      )
    })
  })

  it('displays correct text for low resolution', async () => {
    render(
      <WaveformProgressBanner
        generation={{
          jobId: 'wf_test_123',
          status: 'queued',
          progress: 0,
          resolution: 'low',
        }}
        status={{}}
        audioTrackCount={2}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Low resolution/i)).toBeInTheDocument()
    })
  })

  it('handles 0% progress correctly', async () => {
    render(
      <WaveformProgressBanner
        generation={{
          jobId: 'wf_test_123',
          status: 'processing',
          progress: 0,
          resolution: 'medium',
        }}
        status={{}}
        audioTrackCount={2}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('0%')).toBeInTheDocument()
    })
  })
})
