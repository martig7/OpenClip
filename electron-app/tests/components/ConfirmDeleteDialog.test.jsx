// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import ConfirmDeleteDialog from '../../src/components/ConfirmDeleteDialog.jsx'

describe('ConfirmDeleteDialog', () => {
  const defaultProps = {
    confirmDeleteGame: {
      game: {
        name: 'Valorant',
        scene: 'Valorant Scene',
      },
    },
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with game name in prompt', () => {
    render(<ConfirmDeleteDialog {...defaultProps} />)
    expect(screen.getByText('Valorant')).toBeInTheDocument()
    expect(screen.getByText(/from the list\?/)).toBeInTheDocument()
  })

  it('shows scene warning when game has OBS scene', () => {
    render(<ConfirmDeleteDialog {...defaultProps} />)
    expect(screen.getByText(/This game has an OBS scene/)).toBeInTheDocument()
    expect(screen.getByText('Valorant Scene')).toBeInTheDocument()
  })

  it('calls onConfirm with false when "Game only" is clicked', () => {
    render(<ConfirmDeleteDialog {...defaultProps} />)
    fireEvent.click(screen.getByText('Game only'))
    expect(defaultProps.onConfirm).toHaveBeenCalledWith(false)
  })

  it('calls onConfirm with true when "Game + OBS Scene" is clicked', () => {
    render(<ConfirmDeleteDialog {...defaultProps} />)
    fireEvent.click(screen.getByText('Game + OBS Scene'))
    expect(defaultProps.onConfirm).toHaveBeenCalledWith(true)
  })

  it('calls onCancel when Cancel is clicked', () => {
    render(<ConfirmDeleteDialog {...defaultProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(defaultProps.onCancel).toHaveBeenCalled()
  })

  it('does not render when confirmDeleteGame is null', () => {
    render(<ConfirmDeleteDialog confirmDeleteGame={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText(/Remove/)).not.toBeInTheDocument()
  })

  it('shows simpler UI when game has no scene', () => {
    const propsNoScene = {
      confirmDeleteGame: {
        game: {
          name: 'GameWithoutScene',
          scene: null,
        },
      },
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    }
    render(<ConfirmDeleteDialog {...propsNoScene} />)
    expect(screen.getByText('Remove')).toBeInTheDocument()
    expect(screen.queryByText('Game only')).not.toBeInTheDocument()
    expect(screen.queryByText('Game + OBS Scene')).not.toBeInTheDocument()
  })

  it('closes on overlay click', () => {
    const { container } = render(<ConfirmDeleteDialog {...defaultProps} />)
    const overlay = container.querySelector('.modal-overlay')
    fireEvent.mouseDown(overlay)
    expect(defaultProps.onCancel).toHaveBeenCalled()
  })
})