import { describe, it, expect } from 'vitest'
import { parseWatcherGameState } from '../../src/pages/games/watcherStatusUtils.js'

describe('parseWatcherGameState', () => {
  it('returns muted label for null input', () => {
    const result = parseWatcherGameState(null)
    expect(result.label).toBe('No state file')
    expect(result.color).toBe('var(--text-muted)')
    expect(result.windowTitle).toBeUndefined()
  })

  it('returns idle label for IDLE state', () => {
    const result = parseWatcherGameState('IDLE')
    expect(result.label).toBe('Idle - watching for games')
    expect(result.recording).toBeUndefined()
    expect(result.windowTitle).toBeUndefined()
  })

  it('parses RECORDING state with 2 fields (legacy)', () => {
    const result = parseWatcherGameState('RECORDING|Valorant|')
    expect(result.recording).toBe(true)
    expect(result.game).toBe('Valorant')
    expect(result.label).toBe('Recording Valorant')
    expect(result.windowTitle).toBeUndefined()
  })

  it('parses RECORDING state with window title (4th field)', () => {
    const result = parseWatcherGameState('RECORDING|Valorant|Valorant Scene|VALORANT%20%20')
    expect(result.recording).toBe(true)
    expect(result.game).toBe('Valorant')
    expect(result.windowTitle).toBe('VALORANT  ')
  })

  it('decodes URI-encoded characters in window title', () => {
    const encoded = encodeURIComponent('Game: The Sequel | Chapter 1')
    const result = parseWatcherGameState(`RECORDING|Game|Scene|${encoded}`)
    expect(result.windowTitle).toBe('Game: The Sequel | Chapter 1')
  })

  it('treats empty 4th field as undefined windowTitle', () => {
    const result = parseWatcherGameState('RECORDING|Game|Scene|')
    expect(result.windowTitle).toBeUndefined()
  })
})
