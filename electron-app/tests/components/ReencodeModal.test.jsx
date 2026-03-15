// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import ReencodeModal from '../../src/viewer/components/ReencodeModal.jsx'

describe('ReencodeModal', () => {
  const defaultProps = {
    isOpen: true,
    selectedCount: 2,
    reencodeSettings: { codec: 'h264', crf: 23, preset: 'medium' },
    setReencodeSettings: vi.fn(),
    reencodeAudioTracks: [],
    reencodeSelectedTracks: [],
    loadingTracks: false,
    toggleReencodeTrack: vi.fn(),
    isReencoding: false,
    reencodeProgress: { current: 0, total: 2, currentFile: 'test.mp4' },
    onReencode: vi.fn(),
    onClose: vi.fn(),
  }

  it('renders modal when isOpen is true', () => {
    render(<ReencodeModal {...defaultProps} />)
    expect(screen.getByText('Reencode Videos')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', () => {
    render(<ReencodeModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('Reencode Videos')).not.toBeInTheDocument()
  })

  it('shows progress when reencoding', () => {
    render(<ReencodeModal {...defaultProps} isReencoding={true} />)
    expect(screen.getByText(/Reencoding 0 of 2/)).toBeInTheDocument()
  })
})
