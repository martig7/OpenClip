// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import Modal from '../../src/viewer/components/Modal.jsx'

describe('Modal', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <Modal isOpen={false} title="Test" message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders title and message when open', () => {
    render(
      <Modal isOpen title="Delete File?" message="This cannot be undone." onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByText('Delete File?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn()
    render(
      <Modal isOpen title="T" message="m" onConfirm={vi.fn()} onCancel={onCancel} />
    )
    fireEvent.mouseDown(document.querySelector('.modal-overlay'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not call onCancel when the modal body is clicked', () => {
    const onCancel = vi.fn()
    render(
      <Modal isOpen title="T" message="m" onConfirm={vi.fn()} onCancel={onCancel} />
    )
    fireEvent.click(document.querySelector('.modal'))
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn()
    render(
      <Modal isOpen title="T" message="m" onConfirm={onConfirm} onCancel={vi.fn()} />
    )
    fireEvent.click(screen.getByText('Confirm'))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(
      <Modal isOpen title="T" message="m" onConfirm={vi.fn()} onCancel={onCancel} />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('applies btn-danger class when danger prop is true', () => {
    render(
      <Modal isOpen title="T" message="m" onConfirm={vi.fn()} onCancel={vi.fn()} danger />
    )
    expect(screen.getByText('Confirm')).toHaveClass('btn-danger')
  })

  it('applies btn-primary class when danger prop is false', () => {
    render(
      <Modal isOpen title="T" message="m" onConfirm={vi.fn()} onCancel={vi.fn()} danger={false} />
    )
    expect(screen.getByText('Confirm')).toHaveClass('btn-primary')
  })

  it('uses custom confirmText', () => {
    render(
      <Modal isOpen title="T" message="m" onConfirm={vi.fn()} onCancel={vi.fn()} confirmText="Remove Forever" />
    )
    expect(screen.getByText('Remove Forever')).toBeInTheDocument()
  })

  it('uses custom cancelText', () => {
    render(
      <Modal isOpen title="T" message="m" onConfirm={vi.fn()} onCancel={vi.fn()} cancelText="Go Back" />
    )
    expect(screen.getByText('Go Back')).toBeInTheDocument()
  })
})
