// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import WindowPicker from '../../src/pages/games/WindowPicker.jsx'

describe('WindowPicker', () => {
  const defaultProps = {
    showPicker: true,
    setShowPicker: vi.fn(),
    visibleWindows: [
      { title: 'Valorant', exe: 'VALORANT.exe', hwnd: '1234', windowClass: 'VALORANT', process: 'VALORANT.exe' },
      { title: 'Discord', exe: 'Discord.exe', hwnd: '5678', windowClass: 'Discord', process: 'Discord.exe' },
    ],
    loadingWindows: false,
    onSelect: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('displays running windows list', () => {
    render(<WindowPicker {...defaultProps} />)
    expect(screen.getByText('Valorant')).toBeInTheDocument()
    expect(screen.getByText('Discord')).toBeInTheDocument()
  })

  it('shows window exe in list', () => {
    render(<WindowPicker {...defaultProps} />)
    expect(screen.getByText(/VALORANT\.exe/)).toBeInTheDocument()
    expect(screen.getByText(/Discord\.exe/)).toBeInTheDocument()
  })

  it('filtering by window title', () => {
    const filteredProps = {
      ...defaultProps,
      visibleWindows: [
        { title: 'Valorant Game', exe: 'game.exe', hwnd: '1', windowClass: 'game', process: 'game.exe' },
        { title: 'Not Related', exe: 'other.exe', hwnd: '2', windowClass: 'other', process: 'other.exe' },
      ],
    }
    const { container } = render(<WindowPicker {...filteredProps} />)
    const items = container.querySelectorAll('div[style*="cursor: pointer"]')
    expect(items).toHaveLength(2)
  })

  it('calls onSelect when window is clicked', () => {
    render(<WindowPicker {...defaultProps} />)
    fireEvent.click(screen.getByText('Valorant'))
    expect(defaultProps.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Valorant' })
    )
    expect(defaultProps.setShowPicker).toHaveBeenCalledWith(false)
  })

  it('shows loading state', () => {
    render(<WindowPicker {...defaultProps} visibleWindows={[]} loadingWindows={true} />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows empty state when no windows', () => {
    render(<WindowPicker {...defaultProps} visibleWindows={[]} />)
    expect(screen.getByText('No windows found. Click again to refresh.')).toBeInTheDocument()
  })

  it('does not render when showPicker is false', () => {
    render(<WindowPicker {...defaultProps} showPicker={false} />)
    expect(screen.queryByText('Valorant')).not.toBeInTheDocument()
  })

  it('toggles picker when button is clicked', () => {
    render(<WindowPicker {...defaultProps} showPicker={false} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(defaultProps.setShowPicker).toHaveBeenCalledWith(true)
  })
})