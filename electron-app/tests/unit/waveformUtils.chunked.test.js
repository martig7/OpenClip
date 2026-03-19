import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'
import { EventEmitter } from 'events'

const _req = createRequire(import.meta.url)
const { calculateRawPeaks } = _req('../../electron/waveformUtils.js')

// Access the shared child_process mock from setup.js
import { _cpMock } from '../setup.js'

describe('calculateRawPeaks', () => {
  it('returns empty array for empty samples', () => {
    expect(calculateRawPeaks(new Float32Array([]), 10)).toEqual([])
  })

  it('returns at most numPeaks values', () => {
    const samples = new Float32Array(1000).fill(0.5)
    const peaks = calculateRawPeaks(samples, 10)
    expect(peaks.length).toBe(10)
  })

  it('returns raw amplitude values — max peak is NOT normalized to 1.0', () => {
    // Values are [0.2, 0.4] — raw max is 0.4, not 1.0
    const samples = new Float32Array([0.2, 0.2, 0.4, 0.4])
    const peaks = calculateRawPeaks(samples, 2)
    expect(peaks[0]).toBeCloseTo(0.2)
    expect(peaks[1]).toBeCloseTo(0.4)
    expect(peaks[1]).not.toBeCloseTo(1.0)
  })

  it('returns absolute values (handles negative samples)', () => {
    const samples = new Float32Array([-0.8, -0.8])
    const peaks = calculateRawPeaks(samples, 1)
    expect(peaks[0]).toBeCloseTo(0.8)
  })
})

describe('generateWaveformChunk', () => {
  const { generateWaveformChunk } = _req('../../electron/waveformUtils.js')

  function makeMockProc(floatData, exitCode = 0) {
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = { resume: vi.fn() }
    proc.kill = vi.fn()
    setTimeout(() => {
      if (floatData) proc.stdout.emit('data', Buffer.from(floatData.buffer))
      proc.emit('close', exitCode)
    }, 5)
    return proc
  }

  beforeEach(() => {
    _cpMock.spawn.mockReset()
  })

  it('returns raw peaks array for valid audio', async () => {
    _cpMock.spawn.mockImplementationOnce(() =>
      makeMockProc(new Float32Array([0.2, 0.4, 0.6, 0.8]))
    )
    const peaks = await generateWaveformChunk('/fake/file.mp4', 0, 0, 30, 4)
    expect(peaks).not.toBeNull()
    expect(peaks.length).toBe(4)
    // Raw — highest value should be 0.8, not normalized to 1.0
    expect(Math.max(...peaks)).toBeCloseTo(0.8)
  })

  it('spawns ffmpeg with -ss before -i for fast seeking', async () => {
    _cpMock.spawn.mockImplementationOnce(() =>
      makeMockProc(new Float32Array([0.5]))
    )
    await generateWaveformChunk('/fake/file.mp4', 0, 60, 90, 1)
    const [, args] = _cpMock.spawn.mock.calls[0]
    const ssIndex = args.indexOf('-ss')
    const iIndex = args.indexOf('-i')
    expect(ssIndex).toBeGreaterThan(-1)
    expect(iIndex).toBeGreaterThan(-1)
    expect(ssIndex).toBeLessThan(iIndex) // -ss must come before -i
    expect(args[ssIndex + 1]).toBe('60') // correct start time
  })

  it('returns null when ffmpeg exits with non-zero code', async () => {
    _cpMock.spawn.mockImplementationOnce(() => makeMockProc(null, 1))
    const peaks = await generateWaveformChunk('/fake/file.mp4', 0, 0, 30, 10)
    expect(peaks).toBeNull()
  })

  it('returns null when ffmpeg emits an error', async () => {
    _cpMock.spawn.mockImplementationOnce(() => {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter()
      proc.stderr = { resume: vi.fn() }
      proc.kill = vi.fn()
      setTimeout(() => proc.emit('error', new Error('spawn failed')), 5)
      return proc
    })
    const peaks = await generateWaveformChunk('/fake/file.mp4', 0, 0, 30, 10)
    expect(peaks).toBeNull()
  })
})
