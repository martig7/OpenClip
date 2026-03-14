import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclip-obs-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

async function getModule() {
  vi.resetModules()
  return await import('../../electron/obsIntegration.js')
}

describe('readOBSRecordingPath', () => {
  it('returns null when APPDATA is not set', async () => {
    vi.stubEnv('APPDATA', '')
    const { readOBSRecordingPath } = await getModule()
    expect(readOBSRecordingPath()).toBeNull()
  })

  it('returns null when profiles directory does not exist', async () => {
    vi.stubEnv('APPDATA', tmpDir)
    const { readOBSRecordingPath } = await getModule()
    expect(readOBSRecordingPath()).toBeNull()
  })

  it('returns SimpleOutput.FilePath when it exists on disk', async () => {
    // Create a fake OBS directory structure
    const profilesDir = path.join(tmpDir, 'obs-studio', 'basic', 'profiles', 'Default')
    fs.mkdirSync(profilesDir, { recursive: true })

    // Create the recording path that the INI points to
    const recPath = path.join(tmpDir, 'Videos', 'OBS')
    fs.mkdirSync(recPath, { recursive: true })

    fs.writeFileSync(
      path.join(profilesDir, 'basic.ini'),
      `[SimpleOutput]\nFilePath=${recPath}\n`
    )

    vi.stubEnv('APPDATA', tmpDir)
    const { readOBSRecordingPath } = await getModule()
    expect(readOBSRecordingPath()).toBe(recPath)
  })

  it('prefers SimpleOutput over AdvOut', async () => {
    const profilesDir = path.join(tmpDir, 'obs-studio', 'basic', 'profiles', 'Default')
    fs.mkdirSync(profilesDir, { recursive: true })

    const simpleOutPath = path.join(tmpDir, 'SimpleOut')
    const advOutPath = path.join(tmpDir, 'AdvOut')
    fs.mkdirSync(simpleOutPath, { recursive: true })
    fs.mkdirSync(advOutPath, { recursive: true })

    fs.writeFileSync(
      path.join(profilesDir, 'basic.ini'),
      `[SimpleOutput]\nFilePath=${simpleOutPath}\n[AdvOut]\nRecFilePath=${advOutPath}\n`
    )

    vi.stubEnv('APPDATA', tmpDir)
    const { readOBSRecordingPath } = await getModule()
    expect(readOBSRecordingPath()).toBe(simpleOutPath)
  })

  it('falls back to AdvOut when SimpleOutput is missing', async () => {
    const profilesDir = path.join(tmpDir, 'obs-studio', 'basic', 'profiles', 'Default')
    fs.mkdirSync(profilesDir, { recursive: true })

    const advOutPath = path.join(tmpDir, 'AdvOut')
    fs.mkdirSync(advOutPath, { recursive: true })

    fs.writeFileSync(
      path.join(profilesDir, 'basic.ini'),
      `[AdvOut]\nRecFilePath=${advOutPath}\n`
    )

    vi.stubEnv('APPDATA', tmpDir)
    const { readOBSRecordingPath } = await getModule()
    expect(readOBSRecordingPath()).toBe(advOutPath)
  })

  it('skips profiles without basic.ini', async () => {
    const profilesDir = path.join(tmpDir, 'obs-studio', 'basic', 'profiles')
    const p1 = path.join(profilesDir, 'NoIni')
    const p2 = path.join(profilesDir, 'WithIni')
    fs.mkdirSync(p1, { recursive: true })
    fs.mkdirSync(p2, { recursive: true })

    const recPath = path.join(tmpDir, 'rec')
    fs.mkdirSync(recPath, { recursive: true })

    // p2 has the ini, p1 does not
    fs.writeFileSync(
      path.join(p2, 'basic.ini'),
      `[SimpleOutput]\nFilePath=${recPath}\n`
    )

    vi.stubEnv('APPDATA', tmpDir)
    const { readOBSRecordingPath } = await getModule()
    expect(readOBSRecordingPath()).toBe(recPath)
  })

  it('skips a path in INI that does not exist on disk', async () => {
    const profilesDir = path.join(tmpDir, 'obs-studio', 'basic', 'profiles', 'Default')
    fs.mkdirSync(profilesDir, { recursive: true })

    fs.writeFileSync(
      path.join(profilesDir, 'basic.ini'),
      `[SimpleOutput]\nFilePath=${path.join(tmpDir, 'nonexistent-recording-path')}\n`
    )

    // No fallback dirs exist either
    vi.stubEnv('APPDATA', tmpDir)
    vi.stubEnv('USERPROFILE', tmpDir)
    const { readOBSRecordingPath } = await getModule()
    // Should not return the nonexistent path
    expect(readOBSRecordingPath()).toBeNull()
  })

  it('picks the first valid profile when multiple profiles exist', async () => {
    const profilesDir = path.join(tmpDir, 'obs-studio', 'basic', 'profiles')
    const p1 = path.join(profilesDir, 'First')
    const p2 = path.join(profilesDir, 'Second')
    fs.mkdirSync(p1, { recursive: true })
    fs.mkdirSync(p2, { recursive: true })

    const recPath1 = path.join(tmpDir, 'FirstRec')
    const recPath2 = path.join(tmpDir, 'SecondRec')
    fs.mkdirSync(recPath1, { recursive: true })
    fs.mkdirSync(recPath2, { recursive: true })

    fs.writeFileSync(
      path.join(p1, 'basic.ini'),
      `[SimpleOutput]\nFilePath=${recPath1}\n`
    )
    fs.writeFileSync(
      path.join(p2, 'basic.ini'),
      `[SimpleOutput]\nFilePath=${recPath2}\n`
    )

    vi.stubEnv('APPDATA', tmpDir)
    const { readOBSRecordingPath } = await getModule()
    expect(readOBSRecordingPath()).toBe(recPath1)
  })
})
