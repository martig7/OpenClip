import { describe, it, expect } from 'vitest'

// buildAutoClipMapArgs is a pure function — no mocking needed.

describe('buildAutoClipMapArgs', () => {
  async function getBuildFn() {
    const mod = await import('../../electron/fileManager.js')
    return mod.buildAutoClipMapArgs
  }

  it('returns video-only map when audioTracks is empty (no audio)', async () => {
    const buildAutoClipMapArgs = await getBuildFn()
    expect(buildAutoClipMapArgs([])).toEqual(['-map', '0:v:0'])
  })

  it('returns video-only map when audioTracks is null (no audio)', async () => {
    const buildAutoClipMapArgs = await getBuildFn()
    expect(buildAutoClipMapArgs(null)).toEqual(['-map', '0:v:0'])
  })

  it('returns video-only map when audioTracks is undefined (no audio)', async () => {
    const buildAutoClipMapArgs = await getBuildFn()
    expect(buildAutoClipMapArgs(undefined)).toEqual(['-map', '0:v:0'])
  })

  it('maps track 1 to 0:a:0', async () => {
    const buildAutoClipMapArgs = await getBuildFn()
    expect(buildAutoClipMapArgs([1])).toEqual(['-map', '0:v:0', '-map', '0:a:0'])
  })

  it('maps tracks [1, 3] to 0:a:0 and 0:a:2 (1-based to 0-based)', async () => {
    const buildAutoClipMapArgs = await getBuildFn()
    expect(buildAutoClipMapArgs([1, 3])).toEqual([
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-map', '0:a:2',
    ])
  })

  it('maps all 6 tracks correctly', async () => {
    const buildAutoClipMapArgs = await getBuildFn()
    expect(buildAutoClipMapArgs([1, 2, 3, 4, 5, 6])).toEqual([
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-map', '0:a:1',
      '-map', '0:a:2',
      '-map', '0:a:3',
      '-map', '0:a:4',
      '-map', '0:a:5',
    ])
  })
})
