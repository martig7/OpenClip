// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import AudioSourceDropdown from '../../src/pages/games/AudioSourceDropdown.jsx'

describe('AudioSourceDropdown', () => {
  const defaultProps = {
    show: true,
    loading: false,
    error: null,
    sources: [
      { name: 'Game Audio', source: 'obs', kind: 'audio_input' },
      { name: 'Desktop Audio', source: 'obs', kind: 'audio_input' },
      { name: 'Speakers (Realtek)', source: 'windows', kind: 'wasapi' },
    ],
    sceneAudioSources: [{ inputName: 'Game Audio' }],
    onSelect: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists available audio inputs', () => {
    render(<AudioSourceDropdown {...defaultProps} />)
    expect(screen.getByText('OBS Inputs')).toBeInTheDocument()
    expect(screen.getByText('Windows Devices')).toBeInTheDocument()
    expect(screen.getByText('Game Audio')).toBeInTheDocument()
    expect(screen.getByText('Desktop Audio')).toBeInTheDocument()
    expect(screen.getByText('Speakers (Realtek)')).toBeInTheDocument()
  })

  it('selecting source fires onChange', () => {
    render(<AudioSourceDropdown {...defaultProps} />)
    const desktopAudioBtn = screen.getByText('Desktop Audio')
    fireEvent.click(desktopAudioBtn)
    expect(defaultProps.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Desktop Audio' })
    )
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('shows loading state', () => {
    render(<AudioSourceDropdown {...defaultProps} loading={true} />)
    expect(screen.getByText(/Loading/i)).toBeInTheDocument()
  })

  it('shows error state', () => {
    render(<AudioSourceDropdown {...defaultProps} error="Failed to load" />)
    expect(screen.getByText('Failed to load')).toBeInTheDocument()
  })

  it('shows empty state when no sources', () => {
    render(<AudioSourceDropdown {...defaultProps} sources={[]} />)
    expect(screen.getByText('No audio sources found.')).toBeInTheDocument()
  })

  it('disables sources already in scene', () => {
    render(<AudioSourceDropdown {...defaultProps} />)
    const gameAudioBtn = screen.getByRole('button', { name: /Game Audio/i })
    expect(gameAudioBtn).toBeDisabled()
    expect(screen.getByText('In scene')).toBeInTheDocument()
  })

  it('does not render when show is false', () => {
    render(<AudioSourceDropdown {...defaultProps} show={false} />)
    expect(screen.queryByText('Add to Scene')).not.toBeInTheDocument()
  })
})