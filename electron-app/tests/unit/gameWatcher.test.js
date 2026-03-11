import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.hoisted() runs BEFORE imports are resolved.
// Use it to intercept require('./processDetector') before gameWatcher.js is loaded,
// so that koffi (a Windows-only native DLL) is never required in the test environment.
const { mockGetRunningProcessNames, mockGetWindowTitles } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require('module')
  const getRunningProcessNames = vi.fn(() => [])
  const getWindowTitles = vi.fn(() => [])
  const _currentLoad = Module._load.bind(Module)
  Module._load = function (request, parent, isMain) {
    if (request === './processDetector') {
      return { getRunningProcessNames, getWindowTitles }
    }
    return _currentLoad(request, parent, isMain)
  }
  return { mockGetRunningProcessNames: getRunningProcessNames, mockGetWindowTitles: getWindowTitles }
})

import { detectRunningGame } from '../../electron/gameWatcher.js'

function makeGame(overrides = {}) {
  return {
    enabled: true,
    name: 'TestGame',
    selector: '',
    exe: '',
    windowMatchPriority: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockGetRunningProcessNames.mockReturnValue([])
  mockGetWindowTitles.mockReturnValue([])
})

// ─────────────────────────────────────────────────────────────────
// Guard: skip games with empty selector and no exe
// ─────────────────────────────────────────────────────────────────
describe('empty selector + no exe guard', () => {
  it('does not match a game with empty selector and no exe even when windows exist', () => {
    mockGetWindowTitles.mockReturnValue(['some window title'])
    mockGetRunningProcessNames.mockReturnValue(['some.exe'])
    const game = makeGame({ selector: '', exe: '' })
    expect(detectRunningGame([game])).toBeNull()
  })

  it('skips disabled games', () => {
    mockGetWindowTitles.mockReturnValue(['testgame'])
    const game = makeGame({ enabled: false, selector: 'testgame' })
    expect(detectRunningGame([game])).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// Priority 0 (default): title match, then process fallback (no exe)
// ─────────────────────────────────────────────────────────────────
describe('priority 0 — title match', () => {
  it('matches by window title substring', () => {
    mockGetWindowTitles.mockReturnValue(['testgame - main window'])
    const game = makeGame({ selector: 'testgame', windowMatchPriority: 0 })
    expect(detectRunningGame([game])).toBe(game)
  })

  it('matches by process name substring when no exe is bound', () => {
    mockGetRunningProcessNames.mockReturnValue(['testgame.exe'])
    const game = makeGame({ selector: 'testgame', windowMatchPriority: 0 })
    expect(detectRunningGame([game])).toBe(game)
  })

  it('does NOT fall back to process name when exe is bound (priority 0)', () => {
    // With exe bound at priority 0, detection is title-only; process name is not checked.
    mockGetRunningProcessNames.mockReturnValue(['game.exe'])
    mockGetWindowTitles.mockReturnValue([])
    const game = makeGame({ selector: 'mygame', exe: 'game.exe', windowMatchPriority: 0 })
    expect(detectRunningGame([game])).toBeNull()
  })

  it('returns null when title and process do not match', () => {
    mockGetWindowTitles.mockReturnValue(['other window'])
    mockGetRunningProcessNames.mockReturnValue(['other.exe'])
    const game = makeGame({ selector: 'testgame', windowMatchPriority: 0 })
    expect(detectRunningGame([game])).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// Priority 1: title first, exe fallback
// ─────────────────────────────────────────────────────────────────
describe('priority 1 — title first, exe fallback', () => {
  it('matches when window title is found', () => {
    mockGetWindowTitles.mockReturnValue(['game window'])
    const game = makeGame({ selector: 'game window', exe: 'game.exe', windowMatchPriority: 1 })
    expect(detectRunningGame([game])).toBe(game)
  })

  it('falls back to exact exe match when title is not found', () => {
    mockGetRunningProcessNames.mockReturnValue(['game.exe'])
    const game = makeGame({ selector: 'game window', exe: 'game.exe', windowMatchPriority: 1 })
    expect(detectRunningGame([game])).toBe(game)
  })

  it('does not match when title is absent and exe substring is running but not exact', () => {
    mockGetRunningProcessNames.mockReturnValue(['my-game.exe'])
    const game = makeGame({ selector: 'game window', exe: 'game.exe', windowMatchPriority: 1 })
    expect(detectRunningGame([game])).toBeNull()
  })

  it('does not match with empty selector and no exe', () => {
    mockGetWindowTitles.mockReturnValue(['anything'])
    const game = makeGame({ selector: '', exe: '', windowMatchPriority: 1 })
    expect(detectRunningGame([game])).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// Priority 2: exe-only exact match
// ─────────────────────────────────────────────────────────────────
describe('priority 2 — exe only', () => {
  it('matches by exact exe name', () => {
    mockGetRunningProcessNames.mockReturnValue(['game.exe', 'other.exe'])
    const game = makeGame({ selector: 'anything', exe: 'game.exe', windowMatchPriority: 2 })
    expect(detectRunningGame([game])).toBe(game)
  })

  it('does not match when exe is a substring but not exact', () => {
    mockGetRunningProcessNames.mockReturnValue(['my-game.exe'])
    const game = makeGame({ selector: 'anything', exe: 'game.exe', windowMatchPriority: 2 })
    expect(detectRunningGame([game])).toBeNull()
  })

  it('falls back to title/process substring when no exe is bound', () => {
    mockGetWindowTitles.mockReturnValue(['game window'])
    const game = makeGame({ selector: 'game window', exe: '', windowMatchPriority: 2 })
    expect(detectRunningGame([game])).toBe(game)
  })

  it('falls back to process substring when no exe is bound and process matches selector', () => {
    mockGetRunningProcessNames.mockReturnValue(['game.exe'])
    const game = makeGame({ selector: 'game', exe: '', windowMatchPriority: 2 })
    expect(detectRunningGame([game])).toBe(game)
  })

  it('returns null when exe is set but not running', () => {
    mockGetRunningProcessNames.mockReturnValue(['other.exe'])
    const game = makeGame({ selector: 'anything', exe: 'game.exe', windowMatchPriority: 2 })
    expect(detectRunningGame([game])).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────
// Multiple games — first matching enabled game wins
// ─────────────────────────────────────────────────────────────────
describe('multiple games', () => {
  it('returns the first matching game', () => {
    mockGetWindowTitles.mockReturnValue(['game b window'])
    const gameA = makeGame({ name: 'A', selector: 'game a', windowMatchPriority: 0 })
    const gameB = makeGame({ name: 'B', selector: 'game b', windowMatchPriority: 0 })
    expect(detectRunningGame([gameA, gameB])).toBe(gameB)
  })

  it('skips disabled games and returns the next match', () => {
    mockGetWindowTitles.mockReturnValue(['game a window', 'game b window'])
    const gameA = makeGame({ name: 'A', selector: 'game a', enabled: false })
    const gameB = makeGame({ name: 'B', selector: 'game b', enabled: true })
    expect(detectRunningGame([gameA, gameB])).toBe(gameB)
  })
})
