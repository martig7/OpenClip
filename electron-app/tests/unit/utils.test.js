import { describe, it, expect } from 'vitest'
import { formatTime } from '../../src/viewer/utils.js'

describe('formatTime', () => {
  it('formats 0 as 0:00', () => {
    expect(formatTime(0)).toBe('0:00')
  })

  it('formats seconds under one minute', () => {
    expect(formatTime(45)).toBe('0:45')
  })

  it('formats exactly one minute', () => {
    expect(formatTime(60)).toBe('1:00')
  })

  it('formats over an hour', () => {
    expect(formatTime(3723)).toBe('62:03')
  })

  it('returns 0:00 for NaN', () => {
    expect(formatTime(NaN)).toBe('0:00')
  })

  it('returns 0:00 for Infinity', () => {
    expect(formatTime(Infinity)).toBe('0:00')
  })

  it('returns 0:00 for -Infinity', () => {
    expect(formatTime(-Infinity)).toBe('0:00')
  })

  it('floors decimal seconds', () => {
    expect(formatTime(90.9)).toBe('1:30')
  })

  it('pads single-digit seconds', () => {
    expect(formatTime(61)).toBe('1:01')
  })

  it('handles 1 second', () => {
    expect(formatTime(1)).toBe('0:01')
  })
})
